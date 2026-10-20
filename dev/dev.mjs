import { contentFixtures } from "../src/content/fixtures.mjs";
import { createContentReader } from "../src/content/reader.mjs";
import { mountWorks } from "../src/screens/works.mjs";

const params = new URLSearchParams(window.location.search);
if (params.get("theme") === "light") {
  document.documentElement.dataset.theme = "light";
}

const content = createContentReader(contentFixtures);
const app = mountWorks(document.getElementById("works-root"), { content });

const id = params.get("id");
if (id) app.select(id);
