"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_JOB_DESCRIPTION_CHARS,
  MIN_JOB_DESCRIPTION_CHARS,
} from "@/lib/limits";
import { useSession } from "@/lib/session/session-context";
import { Eraser } from "lucide-react";

export function JobDescriptionInput() {
  const { jobDescription, setJobDescription } = useSession();
  const length = jobDescription.length;
  const tooShort = length > 0 && length < MIN_JOB_DESCRIPTION_CHARS;

  return (
    <div className="space-y-3">
      <Textarea
        label="Job description"
        value={jobDescription}
        maxLength={MAX_JOB_DESCRIPTION_CHARS}
        onChange={(event) => setJobDescription(event.target.value)}
        placeholder={
          "Paste the full posting — title, responsibilities, requirements and any 'nice to have' section.\n\nThe more of the posting you include, the more specific the analysis can be."
        }
        hint="Include the requirements section. Company boilerplate and benefits are fine to leave in; they are simply ignored."
        error={
          tooShort
            ? `A posting needs at least ${MIN_JOB_DESCRIPTION_CHARS} characters to analyse. Paste the responsibilities and requirements too.`
            : undefined
        }
        counter={{
          value: length,
          min: MIN_JOB_DESCRIPTION_CHARS,
          max: MAX_JOB_DESCRIPTION_CHARS,
        }}
      />
      {length > 0 ? (
        <Button size="sm" variant="ghost" onClick={() => setJobDescription("")}>
          <Eraser className="size-4" aria-hidden />
          Clear job description
        </Button>
      ) : null}
    </div>
  );
}
