"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PresentButton, PresenterBar, spotlight, stepFromUrl, writeStepToUrl } from "./presenter";

// Step 1 of the demo path lives on the library; every later step is on the project page.
export function LibraryPresenter({ note, projectHref }: { note: string; projectHref: string }) {
  const router = useRouter();
  const [on, setOn] = useState(false);

  const start = useCallback(() => {
    setOn(true);
    writeStepToUrl(0);
    spotlight("library");
    window.scrollTo({ top: 0 });
  }, []);

  const exit = useCallback(() => {
    setOn(false);
    writeStepToUrl(null);
    spotlight(null);
  }, []);

  const go = useCallback(
    (step: number) => {
      if (step === 0) return;
      spotlight(null);
      router.push(`${projectHref}?present=${step + 1}`);
    },
    [projectHref, router],
  );

  // Arriving with ?present (from the project page, or a reload) resumes the presenter here.
  useEffect(() => {
    const id = stepFromUrl() === null ? undefined : setTimeout(start, 0);
    return () => {
      clearTimeout(id);
      spotlight(null);
    };
  }, [start]);

  return on ? <PresenterBar step={0} note={note} onGo={go} onExit={exit} /> : <PresentButton onStart={start} />;
}
