"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, RotateCcw, Send, Trash2 } from "lucide-react";

import { useLocale } from "@/components/providers/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PROJECT_WEBHOOK_EVENT_TYPES } from "@/lib/webhooks";

type Delivery = {
  id: string;
  eventType: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  attemptCount: number;
  responseStatus: number | null;
  createdAt: string | Date;
};

type Endpoint = {
  id: string;
  url: string;
  secret: string;
  eventTypes: string[];
  enabled: boolean;
  lastDeliveryStatus: "PENDING" | "SUCCESS" | "FAILED" | null;
  lastDeliveryCode: number | null;
  lastDeliveryAt: string | Date | null;
  deliveries: Delivery[];
};

type ProjectWebhooksManagerProps = {
  projectId: string;
  endpoints: Endpoint[];
};

type FormState = {
  id?: string;
  url: string;
  enabled: boolean;
  eventTypes: string[];
};

export function ProjectWebhooksManager({
  projectId,
  endpoints: initialEndpoints,
}: ProjectWebhooksManagerProps) {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [endpoints, setEndpoints] = useState(initialEndpoints);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>({
    url: "",
    enabled: true,
    eventTypes: [...PROJECT_WEBHOOK_EVENT_TYPES],
  });

  const copy = useMemo(
    () => ({
      title: locale === "de" ? "Webhooks" : "Webhooks",
      description:
        locale === "de"
          ? "Projektbezogene Events werden signiert ausgeliefert und automatisch erneut versucht."
          : "Project-scoped events are delivered with signatures and automatic retries.",
      add: locale === "de" ? "Webhook hinzufügen" : "Add webhook",
      edit: locale === "de" ? "Webhook bearbeiten" : "Edit webhook",
      url: "URL",
      save: locale === "de" ? "Speichern" : "Save",
      cancel: locale === "de" ? "Abbrechen" : "Cancel",
      sendTest: locale === "de" ? "Test senden" : "Send test",
      rotateSecret:
        locale === "de" ? "Secret rotieren" : "Rotate secret",
      delete: locale === "de" ? "Löschen" : "Delete",
      noEndpoints:
        locale === "de"
          ? "Noch keine Webhook-Endpunkte konfiguriert."
          : "No webhook endpoints configured yet.",
      recentDeliveries:
        locale === "de" ? "Letzte Zustellungen" : "Recent deliveries",
      active: locale === "de" ? "Aktiv" : "Enabled",
    }),
    [locale]
  );

  function resetDialog(nextOpen: boolean) {
    if (!nextOpen) {
      setForm({
        url: "",
        enabled: true,
        eventTypes: [...PROJECT_WEBHOOK_EVENT_TYPES],
      });
    }

    setOpen(nextOpen);
  }

  function openCreateDialog() {
    setForm({
      url: "",
      enabled: true,
      eventTypes: [...PROJECT_WEBHOOK_EVENT_TYPES],
    });
    setOpen(true);
  }

  function openEditDialog(endpoint: Endpoint) {
    setForm({
      id: endpoint.id,
      url: endpoint.url,
      enabled: endpoint.enabled,
      eventTypes: endpoint.eventTypes,
    });
    setOpen(true);
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function toggleEventType(eventType: string) {
    setForm((current) => ({
      ...current,
      eventTypes: current.eventTypes.includes(eventType)
        ? current.eventTypes.filter((value) => value !== eventType)
        : [...current.eventTypes, eventType],
    }));
  }

  async function submitForm() {
    const endpoint = form.id
      ? `/api/projects/${projectId}/webhooks/${form.id}`
      : `/api/projects/${projectId}/webhooks`;
    const method = form.id ? "PATCH" : "POST";

    startTransition(async () => {
      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: form.url,
          enabled: form.enabled,
          eventTypes: form.eventTypes,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        endpoint?: Endpoint;
      };

      if (!response.ok || !data.endpoint) {
        toast.error(
          data.error ??
            (locale === "de"
              ? "Webhook konnte nicht gespeichert werden"
              : "Could not save webhook")
        );
        return;
      }

      setEndpoints((current) => {
        const withoutCurrent = current.filter((item) => item.id !== data.endpoint?.id);
        return [data.endpoint!, ...withoutCurrent];
      });
      resetDialog(false);
      router.refresh();
      toast.success(
        locale === "de" ? "Webhook gespeichert" : "Webhook saved"
      );
    });
  }

  async function runAction(
    endpoint: Endpoint,
    action: "test" | "rotate" | "delete"
  ) {
    const request =
      action === "test"
        ? {
            url: `/api/projects/${projectId}/webhooks/${endpoint.id}/test`,
            method: "POST",
            body: undefined,
          }
        : action === "rotate"
          ? {
              url: `/api/projects/${projectId}/webhooks/${endpoint.id}`,
              method: "PATCH",
              body: JSON.stringify({ rotateSecret: true }),
            }
          : {
              url: `/api/projects/${projectId}/webhooks/${endpoint.id}`,
              method: "DELETE",
              body: undefined,
            };

    if (
      action === "delete" &&
      !window.confirm(
        locale === "de"
          ? `Webhook ${endpoint.url} löschen?`
          : `Delete webhook ${endpoint.url}?`
      )
    ) {
      return;
    }

    startTransition(async () => {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.body
          ? {
              "Content-Type": "application/json",
            }
          : undefined,
        body: request.body,
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        endpoint?: Endpoint;
        ok?: boolean;
      };

      if (!response.ok) {
        toast.error(
          data.error ??
            (locale === "de" ? "Webhook-Aktion fehlgeschlagen" : "Webhook action failed")
        );
        return;
      }

      if (action === "delete") {
        setEndpoints((current) => current.filter((item) => item.id !== endpoint.id));
      } else if (action === "rotate" && data.endpoint) {
        setEndpoints((current) =>
          current.map((item) => (item.id === data.endpoint?.id ? data.endpoint! : item))
        );
      }

      router.refresh();
      toast.success(
        action === "test"
          ? locale === "de"
            ? "Test versendet"
            : "Test sent"
          : action === "rotate"
            ? locale === "de"
              ? "Secret aktualisiert"
              : "Secret rotated"
            : locale === "de"
              ? "Webhook gelöscht"
              : "Webhook deleted"
      );
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{copy.title}</h2>
          <p className="mt-1 text-sm text-gray-500">{copy.description}</p>
        </div>
        <Button
          type="button"
          className="bg-indigo-600 hover:bg-indigo-700"
          onClick={openCreateDialog}
        >
          <Plus className="mr-2 h-4 w-4" />
          {copy.add}
        </Button>
      </div>

      {endpoints.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-16 text-center text-sm text-gray-500">
          {copy.noEndpoints}
        </div>
      ) : (
        <div className="space-y-4">
          {endpoints.map((endpoint) => (
            <section
              key={endpoint.id}
              className="rounded-xl border border-gray-200 bg-white p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-gray-900">
                    {endpoint.url}
                  </p>
                  <p className="mt-1 font-mono text-xs text-gray-400">
                    {endpoint.secret}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant={endpoint.enabled ? "default" : "secondary"}>
                      {endpoint.enabled
                        ? copy.active
                        : locale === "de"
                          ? "Pausiert"
                          : "Paused"}
                    </Badge>
                    {endpoint.eventTypes.map((eventType) => (
                      <Badge key={eventType} variant="outline">
                        {eventType}
                      </Badge>
                    ))}
                    {endpoint.lastDeliveryStatus && (
                      <Badge
                        variant="secondary"
                        className={
                          endpoint.lastDeliveryStatus === "SUCCESS"
                            ? "bg-emerald-50 text-emerald-700"
                            : endpoint.lastDeliveryStatus === "FAILED"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-700"
                        }
                      >
                        {endpoint.lastDeliveryStatus}
                        {endpoint.lastDeliveryCode
                          ? ` · ${endpoint.lastDeliveryCode}`
                          : ""}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(endpoint)}
                  >
                    {locale === "de" ? "Bearbeiten" : "Edit"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => void runAction(endpoint, "test")}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    {copy.sendTest}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => void runAction(endpoint, "rotate")}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {copy.rotateSecret}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => void runAction(endpoint, "delete")}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {copy.delete}
                  </Button>
                </div>
              </div>

              <div className="mt-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {copy.recentDeliveries}
                </p>
                {endpoint.deliveries.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    {locale === "de"
                      ? "Noch keine Zustellungen."
                      : "No deliveries yet."}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {endpoint.deliveries.map((delivery) => (
                      <div
                        key={delivery.id}
                        className="grid gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm text-gray-600 md:grid-cols-[1.5fr_100px_120px_80px]"
                      >
                        <span className="truncate">{delivery.eventType}</span>
                        <span>{delivery.status}</span>
                        <span>
                          {delivery.responseStatus
                            ? `HTTP ${delivery.responseStatus}`
                            : locale === "de"
                              ? "Kein Status"
                              : "No status"}
                        </span>
                        <span>#{delivery.attemptCount}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={resetDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{form.id ? copy.edit : copy.add}</DialogTitle>
            <DialogDescription>
              {locale === "de"
                ? "Deepglot signiert jede Zustellung mit Timestamp und HMAC-Signatur."
                : "Deepglot signs every delivery with a timestamp and HMAC signature."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">{copy.url}</Label>
              <Input
                id="webhook-url"
                type="url"
                value={form.url}
                onChange={(event) => updateForm("url", event.target.value)}
                placeholder="https://example.com/webhooks/deepglot"
              />
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => updateForm("enabled", event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600"
              />
              <span className="text-sm text-gray-700">{copy.active}</span>
            </label>

            <div className="space-y-2">
              <Label>
                {locale === "de" ? "Events" : "Events"}
              </Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {PROJECT_WEBHOOK_EVENT_TYPES.map((eventType) => (
                  <label
                    key={eventType}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={form.eventTypes.includes(eventType)}
                      onChange={() => toggleEventType(eventType)}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                    />
                    <span className="text-sm text-gray-700">{eventType}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => resetDialog(false)}>
              {copy.cancel}
            </Button>
            <Button
              type="button"
              className="bg-indigo-600 hover:bg-indigo-700"
              disabled={isPending || !form.url.trim() || form.eventTypes.length === 0}
              onClick={() => void submitForm()}
            >
              {copy.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
