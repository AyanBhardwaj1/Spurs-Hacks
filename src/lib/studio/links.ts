// Links into ScorePlay's web app. The routes are the app's `/media/media-details/:id` and `/events/:id`,
// read from its JavaScript bundle on 23 October; ScorePlay documents no link format.

const APP = "https://app.scoreplay.io";

export const scoreplayMediaUrl = (id: number) => `${APP}/media/media-details/${id}`;
export const scoreplayEventUrl = (id: number) => `${APP}/events/${id}`;

/** The studio's own download of a planned clip as an edit decision list. */
export const edlHref = (clipId: string) => `/api/studio/edl?clip=${encodeURIComponent(clipId)}`;
