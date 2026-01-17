const { scrapeOrganization, scrapePerson, scrapeProject } = require("./index");

const URL_TO_TEST =
  "https://www.rootdata.com/Investors/detail/YZi%20Labs?k=MjI5";

async function run() {
  // 这里按需要切换调用：scrapeOrganization / scrapePerson / scrapeProject
  await scrapeOrganization(URL_TO_TEST);
}

run();
