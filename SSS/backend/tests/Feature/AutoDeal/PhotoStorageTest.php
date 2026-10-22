<?php

namespace Tests\Feature\AutoDeal;

use App\AutoDeal\Models\Vehicle;
use App\AutoDeal\Support\Cloudinary;
use App\Services\Backup;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

/** Photos: at most 200 KB each (shrunk on the server when a bigger one arrives), on Cloudinary when CLOUDINARY_URL is set. */
class PhotoStorageTest extends AutoDealTestCase
{
    private function payload(array $photos): array
    {
        return [
            'intake_type' => 'customer_buy', 'company_name' => 'Honda', 'model_name' => 'Activa', 'model_year' => 2021,
            'chassis_number' => 'ME4JF50AXL0000001', 'engine_number' => 'JF50E0000001', 'purchase_price' => 40000,
            'intake_date' => now()->toDateString(), 'seller' => ['name' => 'Ramesh', 'phone' => '9876543210'],
            'photos' => array_map(fn ($f) => ['file' => $f, 'type' => 'front'], $photos),
        ];
    }

    /** A noisy 2400×1800 JPEG, well over 200 KB. */
    private function bigJpeg(): UploadedFile
    {
        $img = imagecreatetruecolor(2400, 1800);
        mt_srand(7);
        for ($i = 0; $i < 60000; $i++) {
            imagefilledrectangle($img, $x = mt_rand(0, 2399), $y = mt_rand(0, 1799), $x + 6, $y + 6, mt_rand(0, 0xFFFFFF));
        }
        $path = tempnam(sys_get_temp_dir(), 'big');
        imagejpeg($img, $path, 95);
        imagedestroy($img);

        return new UploadedFile($path, 'big.jpg', 'image/jpeg', null, true);
    }

    public function test_a_big_photo_is_shrunk_to_200_kb_on_the_server(): void
    {
        if (! function_exists('imagecreatetruecolor')) {
            $this->markTestSkipped('needs the GD extension (php -d extension=gd)');
        }
        $big = $this->bigJpeg();
        $this->assertGreaterThan(200 * 1024, $big->getSize());

        $this->signedIn($this->dealerOwner())->post('/autodeal/vehicles', $this->payload([$big]))->assertSessionHasNoErrors();

        $photo = Vehicle::with('photos')->sole()->photos->sole();
        $bytes = Storage::disk('public')->get($photo->file_path);
        $this->assertLessThanOrEqual(200 * 1024, strlen($bytes));
        $this->assertLessThanOrEqual(200, $photo->size_kb);
        $this->assertStringEndsWith('.jpg', $photo->file_path);
        $this->assertNotFalse(imagecreatefromstring($bytes)); // still a picture
    }

    public function test_photos_go_to_cloudinary_and_are_deleted_there(): void
    {
        config(['autodeal.cloudinary_url' => 'cloudinary://111222:s3cret@democloud']);
        Http::fake([
            'api.cloudinary.com/v1_1/democloud/image/upload' => fn (HttpRequest $r) => Http::response([
                'public_id' => 'autodeal/vehicles/'.Vehicle::value('id').'/abc', 'format' => 'jpg',
            ]),
            'api.cloudinary.com/v1_1/democloud/image/destroy' => Http::response(['result' => 'ok']),
            'res.cloudinary.com/*' => Http::response('JPEGBYTES'),
        ]);
        $owner = $this->dealerOwner();
        $this->signedIn($owner)->post('/autodeal/vehicles', $this->payload([$this->jpeg()]))->assertSessionHasNoErrors();

        $vehicle = Vehicle::with('photos')->sole();
        $photo = $vehicle->photos->sole();
        $this->assertSame("cld:autodeal/vehicles/{$vehicle->id}/abc.jpg", $photo->file_path);
        $this->assertSame("https://res.cloudinary.com/democloud/image/upload/autodeal/vehicles/{$vehicle->id}/abc.jpg", $photo->url);
        $this->assertSame([], Storage::disk('public')->allFiles()); // nothing kept on the server

        // signed upload into the vehicle's folder
        Http::assertSent(function (HttpRequest $r) use ($vehicle) {
            if (! str_ends_with($r->url(), '/image/upload')) {
                return false;
            }
            $f = collect($r->data())->pluck('contents', 'name');
            $sig = sha1("folder=autodeal/vehicles/{$vehicle->id}&public_id={$f['public_id']}&timestamp={$f['timestamp']}s3cret");

            return $f['api_key'] === '111222' && $f['signature'] === $sig && $f['folder'] === "autodeal/vehicles/{$vehicle->id}";
        });

        // the photos zip downloads it back
        $zip = tempnam(sys_get_temp_dir(), 'zip');
        $this->assertSame(1, Backup::filesZip($zip));
        $this->assertStringContainsString("cloudinary/autodeal/vehicles/{$vehicle->id}/abc.jpg", (string) file_get_contents($zip));
        @unlink($zip);

        $this->delete(route('autodeal.vehicles.photos.destroy', [$vehicle, $photo]))->assertRedirect();
        $this->assertSame(0, $vehicle->photos()->count());
        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/image/destroy')
            && $r['public_id'] === "autodeal/vehicles/{$vehicle->id}/abc"
            && $r['signature'] === sha1("public_id=autodeal/vehicles/{$vehicle->id}/abc&timestamp={$r['timestamp']}s3cret"));
    }

    public function test_a_failed_cloudinary_upload_saves_nothing(): void
    {
        config(['autodeal.cloudinary_url' => 'cloudinary://111222:s3cret@democloud']);
        Http::fake(['api.cloudinary.com/*' => Http::response(['error' => ['message' => 'Invalid Signature']], 401)]);

        $this->signedIn($this->dealerOwner());
        $this->withoutExceptionHandling();
        try {
            $this->post('/autodeal/vehicles', $this->payload([$this->jpeg()]));
            $this->fail('expected the upload error');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('Invalid Signature', $e->getMessage());
        }
        $this->assertSame(0, Vehicle::count());
    }

    public function test_without_cloudinary_photos_stay_on_the_server(): void
    {
        config(['autodeal.cloudinary_url' => '']);
        $this->assertFalse(Cloudinary::enabled());
        $this->signedIn($this->dealerOwner())->post('/autodeal/vehicles', $this->payload([$this->jpeg()]))->assertSessionHasNoErrors();
        $photo = Vehicle::with('photos')->sole()->photos->sole();
        Storage::disk('public')->assertExists($photo->file_path);
        $this->assertStringStartsWith('/storage/autodeal/vehicles/', $photo->url);
    }
}
