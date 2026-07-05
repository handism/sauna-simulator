import puppeteer from 'puppeteer';

(async () => {
  console.log('Starting benchmark...');
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  let renderCount = 0;

  page.on('console', msg => {
    if (msg.text() === 'TotonouSpace rendered') {
      renderCount++;
    }
  });

  await page.goto('http://localhost:5173/sauna-simulator/');

  console.log('Page loaded. Waiting for 5 seconds to capture renders...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log(`Total renders in 5 seconds: ${renderCount}`);

  await browser.close();
})();
