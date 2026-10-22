// Where the Python shape API lives.
//   ""                                   -> same site (local dev) or, if there is none, the on-device model
//   "https://air-doodle-api.onrender.com" -> your deployed backend (no trailing slash)
// If the backend is asleep, down or blocked, magic shapes quietly runs on-device instead.
window.AIR_DOODLE_API = "";
