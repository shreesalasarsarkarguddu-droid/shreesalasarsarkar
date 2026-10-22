<?php

namespace App\AutoDeal\Console;

use App\AutoDeal\Support\Module;
use App\Services\Backup;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

/**
 * Take Auto Deal out of SSS for good. A full backup comes first (all data as CSV + the photos / documents), then its
 * tables and files go; SSS's own data is not touched. Afterwards the code can be deleted (see the list it prints).
 */
class RemoveCommand extends Command
{
    protected $signature = 'autodeal:remove {--force : Do not ask}';

    protected $description = 'Remove Auto Deal: back it up, then drop its ad_* tables and its uploaded files';

    public function handle(): int
    {
        if (! Module::installed()) {
            $this->info('Auto Deal is not installed (no ad_* tables).');

            return self::SUCCESS;
        }
        if (! $this->option('force') && $this->ask('This deletes every Auto Deal vehicle, sale and photo (after a backup). Type REMOVE to go on') !== 'REMOVE') {
            $this->warn('Nothing was changed.');

            return self::FAILURE;
        }

        $dir = storage_path('app/backups');
        if (! is_dir($dir)) {
            mkdir($dir, 0700, true);
        }
        $stamp = now()->format('Y-m-d-His');
        file_put_contents($data = "$dir/autodeal-final-$stamp.zip", Backup::zip());
        $files = Backup::filesZip($photos = "$dir/autodeal-final-files-$stamp.zip");
        $this->info("Backup: $data and $photos ($files files)");

        Schema::disableForeignKeyConstraints();
        foreach (array_reverse(Module::TABLES) as $table) {
            Schema::dropIfExists("rp_$table");
            Schema::dropIfExists($table);
        }
        Schema::enableForeignKeyConstraints();
        DB::table('migrations')->where('migration', 'like', '%create_autodeal_tables')->delete();
        foreach (Module::fileFolders() as $disk => $folder) {
            Storage::disk($disk)->deleteDirectory($folder);
        }
        $this->info('Auto Deal tables and files removed. SSS data is unchanged.');
        $this->line('Photos on Cloudinary are in the backup above; delete the "'.config('autodeal.cloudinary_folder').'" folder in the Cloudinary Media Library yourself.');
        $this->line('To take the code out too, delete: app/AutoDeal, routes/autodeal.php, config/autodeal.php, resources/autodeal,');
        $this->line('database/migrations/autodeal, public/autodeal-build, tests/Feature/AutoDeal; then remove AutoDealServiceProvider from');
        $this->line('bootstrap/providers.php, "DealerUser" from app/Models/User.php, "autodeal" from App\\Support\\Perm::KEYS and the menu link.');

        return self::SUCCESS;
    }
}
