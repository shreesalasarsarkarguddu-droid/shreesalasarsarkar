<?php

namespace App\AutoDeal\Http\Requests;

use App\AutoDeal\Http\Requests\Concerns\NormalizesParty;
use App\AutoDeal\Models\Sale;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreSaleRequest extends FormRequest
{
    use NormalizesParty;

    /** 404 before validation, so other branches' vehicles can't even be probed. */
    public function authorize(): bool
    {
        abort_unless($this->route('vehicle')->isVisibleTo($this->user()), 404);

        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->normalizeParty('buyer');
    }

    public function rules(): array
    {
        $vehicle = $this->route('vehicle');
        $maxDoc = config('autodeal.max_document_kb');

        return [
            ...$this->partyRules('buyer', 'buyer_id_proof'),

            'selling_price' => ['required', 'numeric', 'min:1', 'max:9999999999'],
            'sale_date' => ['required', 'date', 'before_or_equal:today', 'after_or_equal:'.$vehicle->intake_date->toDateString()],
            'payment_mode' => ['required', Rule::in(Sale::PAYMENT_MODES)],
            'paid_amount' => ['required', 'numeric', 'min:0', 'lte:selling_price'],
            'financier' => ['nullable', 'required_if:payment_mode,finance', 'string', 'max:120'],
            'notes' => ['nullable', 'string', 'max:3000'],

            'documents' => ['nullable', 'array', 'max:4'],
            'documents.*' => ['file', 'mimes:jpg,jpeg,png,webp,pdf', "max:{$maxDoc}"],
        ];
    }

    public function messages(): array
    {
        return [
            ...$this->partyMessages('buyer'),
            'sale_date.after_or_equal' => 'Sale date cannot be before the intake date.',
            'paid_amount.lte' => 'Paid amount cannot exceed the selling price.',
        ];
    }

    public function attributes(): array
    {
        return ['buyer.name' => 'buyer name', 'buyer.phone' => 'buyer mobile'];
    }
}
