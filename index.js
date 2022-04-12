import imghash from "imghash";
import puppeteer from "puppeteer-extra";
import Stealth from "puppeteer-extra-plugin-stealth";
import proxyChain from "proxy-chain";
import { createCursor } from "ghost-cursor";
import { writeFile, writeFileSync } from "fs";
import got from "got";
import path from "path";
import EventEmitter from "events";

global.proxies = [
  "ip:7000:password:username",
];

const findCaptcha = async (page) => {
  await page.waitForSelector(".h-captcha");
  await page.focus(".h-captcha");
};

const findFrame = (frames, frameName) => {
  return frames.filter((f) => f.url().includes(frameName))[0];
};

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const openCaptcha = async (page) => {
  const frames = await page.frames();
  const checkboxFrame = findFrame(frames, "hcaptcha-checkbox");
  try {
    await checkboxFrame.click("#checkbox");
  } catch (err) {
    await sleep(1000);
    await checkboxFrame.click("#checkbox");
  }
};

const downloadRawImage = async (imageURL) => {
  const { body } = await got(imageURL, {
    responseType: `buffer`,
  });
  return body;
};

const saveImage = (imageBuffer, hash) => {
  writeFileSync(
    process.cwd() + "/images/" + hash + ".jpg",
    imageBuffer,
    (err) => {
      if (err) {
        console.log(err);
        return;
      }
    }
  );
};

const savePrompt = async (prompt, hash) => {
  writeFile(process.cwd() + "/prompts/" + hash + ".txt", prompt, (err) => {
    if (err) {
      console.log(err);
      return;
    }
  });
};

const parseProxies = () => {
  const proxyArray = [];
  global.proxies.forEach((p) => {
    const [host, port, password, username] = p.split(":");
    proxyArray.push({
      host,
      port,
      username,
      password,
    });
  });
  return proxyArray;
}

const main = async () => {
  let proxies = parseProxies();
  for (let proxy of proxies) {
    console.log(`Using proxy: ${proxy.host}:${proxy.port}:${proxy.username}:${proxy.password}`);
    puppeteer.use(Stealth());
    const browser = await puppeteer.launch({ args: [`--proxy=http://${proxy.host}:${proxy.port}`] });
    const page = await browser.newPage();
    // Authenticate Proxy
    await page.authenticate({ username: proxy.username, password: proxy.password });
    const doneEmitter = new EventEmitter();
    doneEmitter.on("downloadedImage", async (e) => {
      if (e == 18) {
        await browser.close();
      }
    });
    page.on("response", async (e) => {
      if (e.url().includes("getcaptcha")) {
        const body = await e.json();
        const prompt = body.requester_question.en;
        let imageCount = 0;
        body.tasklist.forEach(async (t) => {
          const buffer = await downloadRawImage(t.datapoint_uri);
          const hash = await imghash.hash(buffer);
          saveImage(buffer, hash);
          savePrompt(prompt, hash);
          imageCount++;
          doneEmitter.emit("downloadedImage", imageCount);
        });
      }
    });
    await page.goto("https://hcaptcha.com");
    await findCaptcha(page);
    await openCaptcha(page);
  }
};
main();
