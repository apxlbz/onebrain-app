// One build, two backends: the hostname decides. The production domain talks
// to the production project; every other host (the dev domain, github.io,
// localhost) is dev. Nothing else in the app knows which world it's in.
export const SUPA_ORIGIN = location.hostname === "onebrain.apxlbz.com"
  ? "https://qlpfjeciekaqzribxlnp.supabase.co"
  : "https://epjkzltwyfexiunbmbel.supabase.co";
export const FN = `${SUPA_ORIGIN}/functions/v1`;
