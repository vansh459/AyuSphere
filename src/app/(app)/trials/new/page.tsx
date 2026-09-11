import { redirect } from "next/navigation";
import { requireActor, withError } from "@/lib/actor";
import { getDb } from "@/db";
import { createTrial } from "@/services/trials";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { BackLink, ErrorBanner, PageHeader } from "@/components/app/shared";

export default async function NewTrialPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireActor("trial.manage");
  const sp = await props.searchParams;

  async function create(formData: FormData) {
    "use server";
    const actor = await requireActor("trial.manage");
    const visitPlan = [0, 1, 2]
      .map((i) => ({
        visitNumber: i + 1,
        name: String(formData.get(`visit_name_${i}`) ?? "").trim(),
        dayOffset: Number(formData.get(`visit_offset_${i}`) ?? NaN),
        windowDays: Number(formData.get(`visit_window_${i}`) ?? NaN),
      }))
      .filter((v) => v.name && Number.isFinite(v.dayOffset));
    let trialId: string;
    try {
      const trial = await createTrial(getDb(), actor, {
        protocolCode: String(formData.get("protocolCode") ?? ""),
        title: String(formData.get("title") ?? ""),
        studyType: formData.get("studyType") === "observational"
          ? "observational"
          : "interventional",
        phase: String(formData.get("phase") ?? "") || undefined,
        intervention: String(formData.get("intervention") ?? ""),
        dosageForm: String(formData.get("dosageForm") ?? "") || undefined,
        targetEnrollment: Number(formData.get("targetEnrollment") ?? 0),
        visitPlan,
      });
      trialId = trial.id;
    } catch (e) {
      redirect(withError("/trials/new", e));
    }
    redirect(`/trials/${trialId}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/trials" label="Clinical Trials" />
      <PageHeader
        title="New Trial"
        subtitle="Creates the trial in draft with IEC / CTRI milestones scaffolded."
      />
      <ErrorBanner message={typeof sp.error === "string" ? sp.error : undefined} />

      <Card>
        <form action={create} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="protocolCode">Protocol code</Label>
              <Input id="protocolCode" name="protocolCode" placeholder="AYU-004" minLength={3} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="targetEnrollment">Target enrolment</Label>
              <Input id="targetEnrollment" name="targetEnrollment" type="number" min={1} required />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" placeholder="Intervention in condition — study type" minLength={5} required />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="studyType">Study type</Label>
              <select
                id="studyType"
                name="studyType"
                className="h-10 rounded-[0.875rem] border border-line bg-surface px-3 outline-none focus:border-primary"
              >
                <option value="interventional">Interventional</option>
                <option value="observational">Observational</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="phase">Phase (optional)</Label>
              <Input id="phase" name="phase" placeholder="II" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="intervention">Ayurveda intervention</Label>
              <Input id="intervention" name="intervention" placeholder="Ashwagandha extract" minLength={2} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="dosageForm">Dosage form</Label>
              <Input id="dosageForm" name="dosageForm" placeholder="capsule" />
            </div>
          </div>

          <p className="microlabel mt-2">Protocol visit plan (at least one row)</p>
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-3 gap-3">
                <Input name={`visit_name_${i}`} placeholder={i === 0 ? "Baseline" : `Visit ${i + 1} name`} defaultValue={i === 0 ? "Baseline" : ""} />
                <Input name={`visit_offset_${i}`} type="number" min={0} placeholder="day offset" defaultValue={i === 0 ? 0 : ""} />
                <Input name={`visit_window_${i}`} type="number" min={0} placeholder="± window days" defaultValue={i === 0 ? 3 : ""} />
              </div>
            ))}
          </div>

          <Button type="submit" className="mt-2 self-start">
            Create trial
          </Button>
        </form>
      </Card>
    </div>
  );
}
