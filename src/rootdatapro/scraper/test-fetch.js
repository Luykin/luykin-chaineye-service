const { scrapeOrganization, scrapePerson, scrapeProject } = require("./index");

const URL_TO_TEST =
  "https://www.rootdata.com/Projects/detail/Solana?k=MTE3";

async function run() {
  // 这里按需要切换调用：scrapeOrganization / scrapePerson / scrapeProject
  await scrapeProject(URL_TO_TEST);
}

run();
