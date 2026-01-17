const { scrapeOrganization, scrapePerson, scrapeProject } = require("./index");

const URL_TO_TEST =
  "https://www.rootdata.com/Projects/detail/Coinbase?k=Mzg3NQ%3D%3D";

async function run() {
  // 这里按需要切换调用：scrapeOrganization / scrapePerson / scrapeProject
  await scrapeProject(URL_TO_TEST);
}

run();
