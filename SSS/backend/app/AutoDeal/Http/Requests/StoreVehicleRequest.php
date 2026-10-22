<?php

namespace App\AutoDeal\Http\Requests;

use App\AutoDeal\Http\Requests\Concerns\NormalizesParty;
use App\AutoDeal\Models\Vehicle;
use App\AutoDeal\Models\VehiclePhoto;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Used for both intake (POST) and edit (PUT); photos are optional on edit. */
class StoreVehicleRequest extends FormRequest
{
    use NormalizesParty;

    /** On edit: 404 before validation for vehicles outside the user's branch. */
    public function authorize(): bool
    {
        $vehicle = $this->route('vehicle');
        abort_if($vehicle && ! $vehicle->isVisibleTo($this->user()), 404);

        return true;
    }

    protected function prepareForValidation(): void
    {
        $upper = fn ($v) => $v === null ? null : strtoupper(preg_replace('/\s+/', '', (string) $v));

        $this->merge([
            'chassis_number' => $upper($this->chassis_number),
            'engine_number' => $upper($this->engine_number),
            'registration_number' => $upper($this->registration_number) ?: null,
            'company_name' => $this->company_name ? trim($this->company_name) : null,
            'model_name' => $this->model_name ? trim($this->model_name) : null,
        ]);
        $this->normalizeParty('seller');
    }

    public function rules(): array
    {
        $vehicle = $this->route('vehicle');
        $maxPhoto = config('autodeal.max_photo_kb');

        return [
            'intake_type' => ['required', Rule::in(Vehicle::INTAKE_TYPES)],
            'company_name' => ['required', 'string', 'max:60'],
            'model_name' => ['required', 'string', 'max:80'],
            'variant' => ['nullable', 'string', 'max:80'],
            'model_year' => ['required', 'integer', 'min:1980', 'max:'.(now()->year + 1)],
            'color' => ['nullable', 'string', 'max:40'],
            'registration_number' => ['nullable', 'string', 'max:20'],
            // Unique across soft-deleted rows too, matching the DB unique index.
            'chassis_number' => ['required', 'string', 'min:5', 'max:32', Rule::unique('ad_vehicles')->ignore($vehicle?->id)],
            'engine_number' => ['required', 'string', 'min:4', 'max:32'],
            // Staff enter the cost at intake but never see or change it afterwards.
            'purchase_price' => [Rule::excludeIf(fn () => $vehicle && ! $this->user()->isDealerOwner()), 'required', 'numeric', 'min:0', 'max:9999999999'],
            'branch_id' => ['nullable', 'integer', Rule::exists('ad_branches', 'id')->where('is_active', true)],
            'expected_price' => ['nullable', 'numeric', 'min:0', 'max:9999999999'],
            'intake_date' => ['required', 'date', 'before_or_equal:today'],
            'remarks' => ['nullable', 'string', 'max:2000'],

            ...$this->partyRules('seller', 'seller_id_proof'),

            'photos' => ['nullable', 'array', 'max:'.config('autodeal.max_photos')],
            'photos.*.file' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', "max:{$maxPhoto}"],
            'photos.*.type' => ['required', Rule::in(VehiclePhoto::TYPES)],
        ];
    }

    /** Explain *why* a chassis is taken when the clash is with a deleted vehicle. */
    public function withValidator($validator): void
    {
        $validator->after(function ($v) {
            if (! $v->errors()->has('chassis_number')) {
                return;
            }
            $trashed = Vehicle::onlyTrashed()->where('chassis_number', $this->chassis_number)->first();
            if ($trashed) {
                $v->errors()->forget('chassis_number');
                $v->errors()->add('chassis_number', "This chassis belongs to a deleted vehicle ({$trashed->title}). Restore it from the “Deleted” tab instead.");
            }
        });
    }

    public function messages(): array
    {
        return [
            ...$this->partyMessages('seller'),
            'chassis_number.unique' => 'A vehicle with this chassis number already exists.',
        ];
    }

    public function attributes(): array
    {
        return [
            'seller.name' => 'seller name',
            'seller.phone' => 'seller mobile',
            'photos.*.file' => 'photo',
        ];
    }
}
