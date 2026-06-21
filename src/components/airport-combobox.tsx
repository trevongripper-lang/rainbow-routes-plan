import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plane } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AIRPORTS, findAirport, searchAirports, type Airport } from "@/data/airports";

type Props = {
  value: string;
  onChange: (iata: string) => void;
  placeholder?: string;
  ariaLabel?: string;
};

export function AirportCombobox({ value, onChange, placeholder = "Airport", ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = findAirport(value);
  const results = useMemo<Airport[]>(
    () => (query.trim() ? searchAirports(query, 12) : AIRPORTS.slice(0, 12)),
    [query],
  );

  const display = selected
    ? `${selected.iata} · ${selected.city}`
    : value
      ? value.toUpperCase()
      : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          className={cn(
            "h-9 w-full justify-between px-3 font-normal",
            !display && "text-muted-foreground",
          )}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            <Plane className="size-3.5 shrink-0 opacity-60" />
            <span className="truncate">{display || placeholder}</span>
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by city, code, or name…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {query.length === 3 ? (
                <button
                  type="button"
                  onClick={() => {
                    onChange(query.toUpperCase());
                    setOpen(false);
                  }}
                  className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  Use <span className="font-mono">{query.toUpperCase()}</span> as-is
                </button>
              ) : (
                "No airports found."
              )}
            </CommandEmpty>
            <CommandGroup>
              {results.map((a) => (
                <CommandItem
                  key={a.iata}
                  value={a.iata}
                  onSelect={() => {
                    onChange(a.iata);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex items-center gap-2"
                >
                  <span className="w-12 font-mono text-xs font-semibold">{a.iata}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="truncate">{a.city}</span>
                    <span className="ml-1 text-xs text-muted-foreground">· {a.name}</span>
                  </span>
                  <Check
                    className={cn(
                      "size-4",
                      value?.toUpperCase() === a.iata ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
