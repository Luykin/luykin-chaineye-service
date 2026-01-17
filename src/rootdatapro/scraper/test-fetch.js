const { scrapeOrganization, scrapePerson, scrapeProject } = require("./index");

const URL_TO_TEST =
  "https://www.rootdata.com/member/Sam%20Kazemian?k=ODk0NA%3D%3D";

async function run() {
  // 这里按需要切换调用：scrapeOrganization / scrapePerson / scrapeProject
  await scrapePerson(URL_TO_TEST);
}

run();
