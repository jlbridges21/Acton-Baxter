"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AddressSuggestion, SelectedAddress } from "@/lib/address/types";

type AddressAutocompleteProps = {
  value: SelectedAddress | null;
  query: string;
  onChange: (address: SelectedAddress | null) => void;
  onQueryChange: (query: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
};

export function AddressAutocomplete({
  value,
  query,
  onChange,
  onQueryChange,
  disabled = false,
  placeholder = "Start typing a California property address",
  id,
}: AddressAutocompleteProps) {
  const generatedId = useId();
  const listboxId = `${generatedId}-listbox`;
  const inputId = id ?? `${generatedId}-input`;
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const skipFetchRef = useRef(false);

  useEffect(() => {
    if (skipFetchRef.current) {
      skipFetchRef.current = false;
      return;
    }
    if (disabled || selecting || value) return;

    const trimmed = query.trim();
    const timer = window.setTimeout(() => {
      void (async () => {
        if (trimmed.length < 3) {
          setSuggestions([]);
          setOpen(false);
          setLoading(false);
          abortRef.current?.abort();
          return;
        }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        setError(null);

        try {
          const response = await fetch(
            `/api/address/autocomplete?query=${encodeURIComponent(trimmed)}`,
            { signal: controller.signal },
          );
          const payload = (await response.json()) as {
            suggestions?: AddressSuggestion[];
            error?: { message?: string };
          };
          if (!response.ok) {
            throw new Error(payload.error?.message ?? "Unable to load address suggestions");
          }
          if (controller.signal.aborted) return;
          setSuggestions(payload.suggestions ?? []);
          setOpen(true);
          setHighlightedIndex(-1);
        } catch (err) {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setError(err instanceof Error ? err.message : "Unable to load suggestions");
        } finally {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        }
      })();
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [query, disabled, selecting, value]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  async function selectSuggestion(suggestion: AddressSuggestion) {
    setSelecting(true);
    setOpen(false);
    setError(null);
    skipFetchRef.current = true;
    onQueryChange(suggestion.description);

    try {
      const response = await fetch(`/api/address/place/${encodeURIComponent(suggestion.placeId)}`);
      const payload = (await response.json()) as {
        address?: SelectedAddress;
        error?: { message?: string };
      };
      if (!response.ok || !payload.address) {
        throw new Error(payload.error?.message ?? "Unable to confirm selected address");
      }
      skipFetchRef.current = true;
      onQueryChange(payload.address.formattedAddress);
      onChange(payload.address);
      setSuggestions([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to confirm selected address");
      onChange(null);
    } finally {
      setSelecting(false);
    }
  }

  function handleQueryChange(next: string) {
    onQueryChange(next);
    if (value) {
      onChange(null);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (event.key === "Escape") {
        setOpen(false);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
      return;
    }
    if (event.key === "Enter" && highlightedIndex >= 0) {
      event.preventDefault();
      const suggestion = suggestions[highlightedIndex];
      if (suggestion) void selectSuggestion(suggestion);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setHighlightedIndex(-1);
    }
  }

  const activeOptionId =
    highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <MapPin className="absolute top-3.5 left-3 h-4 w-4 text-[var(--acton-muted)]" />
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-haspopup="listbox"
          disabled={disabled || selecting}
          placeholder={placeholder}
          value={query}
          autoComplete="off"
          className="pl-9"
          onChange={(event) => handleQueryChange(event.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {loading || selecting ? (
        <p className="mt-2 text-xs text-[var(--acton-muted)]">
          {selecting ? "Confirming address..." : "Searching addresses..."}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}

      {open && suggestions.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-[var(--acton-border)] bg-white py-1 shadow-lg"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.placeId}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === highlightedIndex}
              className={cn(
                "cursor-pointer px-3 py-2 text-sm",
                index === highlightedIndex
                  ? "bg-[var(--acton-gray-100)] text-[var(--acton-navy)]"
                  : "text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
              )}
              onMouseEnter={() => setHighlightedIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                void selectSuggestion(suggestion);
              }}
            >
              <span className="block font-medium">{suggestion.mainText}</span>
              <span className="block text-xs text-[var(--acton-muted)]">
                {suggestion.secondaryText}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
