import React, { useMemo } from "react";
import { processJobDescription } from "./job-description.js";

export default function ProcessedJobDescription({ job, className = "" }) {
  const description = job?.description || "";
  const title = job?.title || "";
  const company = job?.company || "";
  const content = useMemo(
    () => processJobDescription({ description, title, company }),
    [description, title, company],
  );
  const classes = ["processed-job-description", className]
    .filter(Boolean)
    .join(" ");

  if (!content.sourceAvailable) {
    return (
      <section className={classes} aria-label="Job description">
        <h3>Role overview</h3>
        <p className="job-description-empty">
          A job overview is not available. Open the original listing for details.
        </p>
      </section>
    );
  }

  return (
    <section className={classes} aria-label="Structured job description">
      <div className="job-description-overview">
        <h3>Role overview</h3>
        {content.overview.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      {content.sections.length > 0 && (
        <div className="job-description-key-points">
          <h3>Key points</h3>
          <div className="job-description-sections">
            {content.sections.map((section) => (
              <section
                className={`job-description-section tone-${section.kind}`}
                key={`${section.kind}:${section.title}`}
              >
                <h4>{section.title}</h4>
                {section.paragraphs.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
                {section.items.length > 0 && (
                  <ul>
                    {section.items.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </div>
      )}
      <p className="job-description-source-note">
        Key points are organised from the source description. Check the original
        listing before you apply.
      </p>
    </section>
  );
}
