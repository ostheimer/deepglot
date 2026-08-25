"use client";

import { useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deletePasskeyAction } from "@/app/(dashboard)/einstellungen/passkey-actions";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export type PasskeySummary = {
  credentialID: string;
  credentialBackedUp: boolean;
  createdAt: string;
};

type PasskeySettingsProps = {
  locale: SiteLocale;
  passkeys: PasskeySummary[];
};

export function PasskeySettings({ locale, passkeys }: PasskeySettingsProps) {
  const [items, setItems] = useState(passkeys);
  const [isRegistering, setIsRegistering] = useState(false);
  const [deletingCredentialID, setDeletingCredentialID] = useState<
    string | null
  >(null);

  async function registerPasskey() {
    setIsRegistering(true);

    try {
      if (!("PublicKeyCredential" in window)) {
        toast.error(
          uiText(
            locale,
            "This browser does not support passkeys.",
            "Dieser Browser unterstützt keine Passkeys."
          )
        );
        return;
      }

      const { signIn: signInWithPasskey } = await import("next-auth/webauthn");
      const result = await signInWithPasskey("passkey", {
        action: "register",
        redirect: false,
        redirectTo: window.location.href,
      });

      if (!result?.ok || result.error) {
        toast.error(
          uiText(
            locale,
            "The passkey could not be added.",
            "Der Passkey konnte nicht hinzugefügt werden."
          )
        );
        return;
      }

      toast.success(
        uiText(locale, "Passkey added.", "Passkey hinzugefügt.")
      );
      window.location.reload();
    } catch {
      toast.error(
        uiText(
          locale,
          "Passkey setup was cancelled or failed.",
          "Die Passkey-Einrichtung wurde abgebrochen oder ist fehlgeschlagen."
        )
      );
    } finally {
      setIsRegistering(false);
    }
  }

  async function deletePasskey(credentialID: string) {
    setDeletingCredentialID(credentialID);

    try {
      const result = await deletePasskeyAction(credentialID);
      if (!result.success) {
        toast.error(
          uiText(
            locale,
            "The passkey could not be removed.",
            "Der Passkey konnte nicht entfernt werden."
          )
        );
        return;
      }

      setItems((current) =>
        current.filter((item) => item.credentialID !== credentialID)
      );
      toast.success(
        uiText(locale, "Passkey removed.", "Passkey entfernt.")
      );
    } catch {
      toast.error(
        uiText(
          locale,
          "The passkey could not be removed.",
          "Der Passkey konnte nicht entfernt werden."
        )
      );
    } finally {
      setDeletingCredentialID(null);
    }
  }

  return (
    <div className="border-t border-gray-100 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-brand-600" aria-hidden="true" />
            <p className="text-sm font-medium text-gray-900">Passkeys</p>
          </div>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-gray-500">
            {uiText(
              locale,
              "Sign in securely with your device, fingerprint, or face recognition. Password and connected-provider login remain available.",
              "Melde dich sicher mit deinem Gerät, Fingerabdruck oder Gesichtserkennung an. Passwort und verbundene Login-Anbieter bleiben verfügbar."
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={registerPasskey}
          disabled={isRegistering || deletingCredentialID !== null}
          className="shrink-0"
        >
          <Plus aria-hidden="true" />
          {isRegistering
            ? uiText(locale, "Adding…", "Wird hinzugefügt…")
            : uiText(locale, "Add passkey", "Passkey hinzufügen")}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
          {uiText(
            locale,
            "No passkey has been added yet.",
            "Noch kein Passkey hinzugefügt."
          )}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
          {items.map((passkey, index) => (
            <li
              key={passkey.credentialID}
              className="flex items-center justify-between gap-4 px-3 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {uiText(locale, "Passkey", "Passkey")} {index + 1}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {passkey.credentialBackedUp
                    ? uiText(locale, "Synced passkey", "Synchronisierter Passkey")
                    : uiText(locale, "Device-bound passkey", "Gerätegebundener Passkey")}
                  {" · "}
                  {uiText(locale, "Added", "Hinzugefügt")} {" "}
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                  }).format(new Date(passkey.createdAt))}
                </p>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={
                      isRegistering || deletingCredentialID !== null
                    }
                    aria-label={uiText(
                      locale,
                      `Remove passkey ${index + 1}`,
                      `Passkey ${index + 1} entfernen`
                    )}
                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {uiText(locale, "Remove passkey?", "Passkey entfernen?")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {uiText(
                        locale,
                        "This device can no longer use this passkey to sign in. Your password and connected-provider login are not changed.",
                        "Dieses Gerät kann diesen Passkey danach nicht mehr zur Anmeldung verwenden. Dein Passwort und verbundene Login-Anbieter bleiben unverändert."
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      {uiText(locale, "Cancel", "Abbrechen")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deletePasskey(passkey.credentialID)}
                      className="bg-red-600 text-white hover:bg-red-700"
                    >
                      {uiText(locale, "Remove", "Entfernen")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
