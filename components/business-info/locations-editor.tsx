"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { HEAD_OFFICE_LABEL, MAX_BRANCHES } from "@/lib/business-info/locations";
import type { LocationValue } from "@/components/brand-profile/steps";
import { PlaceSearch, type PickedPlace } from "./place-search";

/** The head office (always the first row) and up to MAX_BRANCHES branches. Errors use "locations.<i>.<field>" keys. */
export function LocationsEditor({
  locations,
  errors,
  placesEnabled,
  onChange,
}: {
  locations: LocationValue[];
  errors: Record<string, string>;
  placesEnabled: boolean;
  onChange: (locations: LocationValue[]) => void;
}) {
  const branches = locations.filter((l) => l.kind === "branch").length;
  const headFilled = !!locations[0]?.address.trim();

  function update(i: number, patch: Partial<LocationValue>) {
    onChange(locations.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  const typed = (i: number) => (address: string) => update(i, { address, placeId: undefined, lat: undefined, lng: undefined });
  const picked = (i: number) => (p: PickedPlace) =>
    update(i, { address: p.address, placeId: p.placeId, lat: p.lat, lng: p.lng, ...(locations[i].kind === "branch" && !locations[i].label.trim() ? { label: p.name.slice(0, 80) } : {}) });

  return (
    <div className="flex flex-col gap-3">
      {locations.map((l, i) => {
        const head = l.kind === "head";
        return (
          <div key={i} className="glass flex flex-col gap-3 rounded-2xl p-4">
            <Field label={head ? "Name (optional)" : "Branch name"} error={errors[`locations.${i}.label`]}>
              <Input maxLength={80} placeholder={head ? HEAD_OFFICE_LABEL : "e.g. City centre branch"} value={l.label} onChange={(e) => update(i, { label: e.target.value })} />
            </Field>
            <PlaceSearch
              label={head ? "Head office address" : "Branch address"}
              required={head && branches > 0}
              address={l.address}
              placeId={l.placeId}
              lat={l.lat}
              lng={l.lng}
              enabled={placesEnabled}
              error={errors[`locations.${i}.address`]}
              onType={typed(i)}
              onPick={picked(i)}
            />
            {!head && (
              <Button variant="outline" size="sm" className="self-start" leading={<Trash2 aria-hidden className="size-4" />} onClick={() => onChange(locations.filter((_, j) => j !== i))}>
                Remove branch
              </Button>
            )}
          </div>
        );
      })}
      {errors["locations.form"] && (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {errors["locations.form"]}
        </p>
      )}
      {branches < MAX_BRANCHES && (
        <div className="flex flex-col gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={!headFilled}
            leading={<Plus aria-hidden className="size-4" />}
            onClick={() => onChange([...locations, { kind: "branch", label: "", address: "" }])}
          >
            Add branch
          </Button>
          {!headFilled && <p className="text-[13px] text-muted">Add the head office address first.</p>}
        </div>
      )}
    </div>
  );
}
