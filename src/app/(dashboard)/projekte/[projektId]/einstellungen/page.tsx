import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function EinstellungenPage({ params }: PageProps) {
  const { projektId } = await params;

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: { languages: true },
  });

  if (!project) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-xl font-bold text-gray-900">Allgemeine Einstellungen</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Projektinformationen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Projektname</Label>
            <Input defaultValue={project.name} />
          </div>
          <div className="space-y-2">
            <Label>Domain</Label>
            <Input defaultValue={project.domain} />
          </div>
          <div className="space-y-2">
            <Label>Originalsprache</Label>
            <Input defaultValue={project.originalLang.toUpperCase()} disabled />
          </div>
          <Button className="bg-indigo-600 hover:bg-indigo-700">
            Änderungen speichern
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weiterleitungseinstellungen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">
                Automatische Browser-Weiterleitung
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Besucher werden automatisch anhand ihrer Browser-Sprache weitergeleitet
              </p>
            </div>
            <Badge variant="outline">Deaktiviert</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-base text-red-700">Gefahrenzone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Projekt löschen</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Löscht das Projekt und alle gespeicherten Übersetzungen unwiderruflich.
              </p>
            </div>
            <Button variant="destructive" size="sm">
              Projekt löschen
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
