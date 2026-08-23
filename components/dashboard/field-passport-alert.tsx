"use client";

import { AlertTriangle } from "lucide-react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { FIELD_PASSPORT_BLOCKED_MESSAGE } from "@/lib/field-passport";
import { cn } from "@/lib/utils";

type FieldPassportBlockedAlertProps = {
  className?: string;
  /** Коротка підказка під формою швидкого доповнення паспорта */
  hint?: string;
};

/**
 * Попередження: операція заблокована через незаповнений паспорт поля.
 * Для редагування використовуйте FieldPassportQuickFix поруч.
 */
export function FieldPassportBlockedAlert({
  className,
  hint = "Заповніть картку паспорта нижче — після збереження операція розблокується.",
}: FieldPassportBlockedAlertProps) {
  return (
    <Alert variant="destructive" className={cn(className)}>
      <AlertTriangle />
      <AlertTitle className="font-semibold">Паспорт поля</AlertTitle>
      <AlertDescription>
        <p>{FIELD_PASSPORT_BLOCKED_MESSAGE}</p>
        {hint ? (
          <p className="mt-2 text-xs text-rose-800/80">{hint}</p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
