import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function BulkConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  willApply,
  skipped,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  willApply: { id: string; label: string }[];
  skipped: { id: string; label: string; reason: string }[];
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <div className="max-h-72 overflow-auto space-y-3 text-sm">
          {willApply.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Will apply to {willApply.length}
              </p>
              <ul className="space-y-0.5">
                {willApply.map((w) => (
                  <li key={w.id} className="truncate">• {w.label}</li>
                ))}
              </ul>
            </div>
          )}
          {skipped.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Skipped ({skipped.length})
              </p>
              <ul className="space-y-0.5 text-muted-foreground">
                {skipped.map((s) => (
                  <li key={s.id} className="truncate">• {s.label} — <span className="italic">{s.reason}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={willApply.length === 0}
            className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
