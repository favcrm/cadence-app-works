import { mountWorksWrite } from "../src/screens/works-write.mjs";

const params = new URLSearchParams(window.location.search);
if (params.get("theme") === "light") {
  document.documentElement.dataset.theme = "light";
}

mountWorksWrite(document.getElementById("works-root"), {
  host: params.get("host") ?? undefined,
  status: document.getElementById("host-status"),
  feedback: document.getElementById("write-feedback"),
  actorInput: document.getElementById("write-actor"),
});
