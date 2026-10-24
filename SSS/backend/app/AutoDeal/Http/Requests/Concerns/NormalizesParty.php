<?php

namespace App\AutoDeal\Http\Requests\Concerns;

/** Shared rules and normalisation for seller/buyer ("party") sub-forms. */
trait NormalizesParty
{
    protected function normalizeParty(string $key): void
    {
        $party = $this->input($key, []);
        if (! is_array($party)) {
            return;
        }

        if (isset($party['phone'])) {
            // Accept "+91 98765-43210", "098765 43210" etc. and keep the last 10 digits.
            $digits = preg_replace('/\D/', '', (string) $party['phone']);
            $party['phone'] = strlen($digits) > 10 ? substr($digits, -10) : $digits;
        }
        $party['name'] = isset($party['name']) ? trim(preg_replace('/\s+/', ' ', $party['name'])) : null;

        $this->merge([$key => $party]);
    }

    /** $optional (the intake's seller): all may be empty; a name is needed once anything else is filled in. */
    protected function partyRules(string $key, string $fileKey, bool $optional = false): array
    {
        $maxDoc = config('autodeal.max_document_kb');
        $name = $optional
            ? ['nullable', "required_with:{$key}.phone,{$key}.address,{$fileKey}", 'string', 'max:120']
            : ['required', 'string', 'max:120'];

        return [
            "{$key}.name" => $name,
            "{$key}.phone" => [$optional ? 'nullable' : 'required', 'regex:/^[6-9]\d{9}$/'],
            "{$key}.address" => ['nullable', 'string', 'max:500'],
            "{$key}.id_proof_type" => ['nullable', 'in:aadhaar,driving_license,pan,voter_id,other'],
            $fileKey => ['nullable', 'file', 'mimes:jpg,jpeg,png,webp,pdf', "max:{$maxDoc}"],
        ];
    }

    protected function partyMessages(string $key): array
    {
        return [
            "{$key}.phone.regex" => 'Enter a valid 10-digit Indian mobile number.',
            "{$key}.name.required_with" => 'Enter the name too (or leave the seller empty).',
        ];
    }
}
