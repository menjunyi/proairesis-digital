export function listingAvailability(job, now = Date.now()) {
  const expired = Boolean(job.expiresAt && Date.parse(job.expiresAt) <= now);
  if (job.availability === "closed" || expired) {
    return {
      status: "closed",
      title: "This opportunity is closed",
      message:
        job.availabilityMessage ||
        (expired
          ? "The saved closing date has passed."
          : "The source reports that this opportunity is no longer available."),
      checkedAt: job.availabilityCheckedAt,
    };
  }
  if (job.availability === "available") {
    return { status: "available", checkedAt: job.availabilityCheckedAt };
  }
  return {
    status: "unknown",
    title: "Listing availability needs confirmation",
    message:
      job.availabilityMessage ||
      "We could not confirm whether this listing is still open. Check the original listing before preparing another letter.",
    checkedAt: job.availabilityCheckedAt,
  };
}

export function canRequestLetter(job, hasExistingRequest, now = Date.now()) {
  return (
    hasExistingRequest || listingAvailability(job, now).status !== "closed"
  );
}
