// MIT. Local UI policy for the source-specific image description. The portable
// package schema and the Composer contract are unchanged: no artwork, credit or
// description is inferred from a newly chosen image.
/**
 * Decide the image description when a new source is chosen. The sample's
 * description belongs to the sample artwork, so it is dropped for a different
 * image while it is still the untouched default. User-authored and imported
 * descriptions are kept exactly as written.
 */
export function descriptionForSource(
  description: string,
  isSample: boolean,
  untouchedSampleCopy: boolean,
): string {
  return !isSample && untouchedSampleCopy ? "" : description;
}
