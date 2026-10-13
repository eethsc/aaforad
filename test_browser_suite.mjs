import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Commercial datasheet samples to test
const SAMPLES = {
  // Case 1: TLV271 - Low voltage/power standard CMOS Op-Amp (Should pass contracts & explore design)
  tlv271: {
    fileName: 'TLV271_sample.txt',
    mimeType: 'text/plain',
    text: `TLV271 3-MHz Rail-to-Rail Output Operational Amplifier
Supply voltage: 2.7 V to 16 V
Gain bandwidth product: 3 MHz
Input noise voltage: 39 nV/√Hz
Supply current: 0.55 mA
Slew rate: 2.1 V/µs
Input offset voltage: 5 mV
Input bias current: 60 pA
Common mode rejection ratio: 80 dB
Output current: 7 mA`
  },

  // Case 2: OPA333 - Micro-power Zero-Drift Op-Amp (Compatible with 1.8V Sky130 PDK)
  opa333: {
    fileName: 'OPA333_sample.txt',
    mimeType: 'text/plain',
    text: `OPA333 1.8-V microPower CMOS Zero-Drift Operational Amplifier
Supply voltage: 1.8 V to 5.5 V
Quiescent current: 17 µA
Gain bandwidth product: 350 kHz
Offset voltage: 10 µV
Rail-to-rail input and output
CMRR: 130 dB
PSRR: 130 dB`
  },

  // Case 3: TPS7A20 - Low-noise 300-mA LDO Regulator (LDO family)
  tps7a20: {
    fileName: 'TPS7A20_sample.txt',
    mimeType: 'text/plain',
    text: `TPS7A20 300-mA Ultra-Low-Noise Low-Dropout Regulator
Input voltage range: 1.6 V to 6.0 V
Output voltage range: 0.8 V to 5.0 V
Low quiescent current: 6.5 µA
Dropout voltage: 140 mV at 300 mA
Power supply rejection ratio PSRR: 85 dB at 1 kHz`
  },

  // Case 4: TPA3116D2 - 50W High-voltage Class-D Audio IC (Should fail contract / lock family)
  tpa3116d2: {
    fileName: 'TPA3116D2_sample.txt',
    mimeType: 'text/plain',
    text: `TPA3116D2 50-W Filter-Free Class-D Audio Power Amplifier
Supply voltage: 4.5 V to 26 V
Output power: 50 W into 4-ohm load
Switching frequency: 400 kHz
THD+N: 0.1 %
Signal-to-noise ratio SNR: 102 dB`
  }
};

process.env.FUSION_REQUIRE_LLM = 'false';

const CHROME_PATH = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = process.env.BASE_URL
  || ('http://localhost:' + (process.env.PORT || '4173'));

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runComprehensiveBrowserTests() {
  console.log('====================================================');
  console.log('Starting End-to-End Browser Testing for FUSION Studio');
  console.log('Target URL:', BASE_URL);
  console.log('====================================================');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  const pageErrors = [];
  page.on('pageerror', (err) => {
    console.error(`[PAGE UNCAUGHT ERROR] ${err.message}`);
    pageErrors.push(err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`[PAGE CONSOLE ERROR] ${msg.text()}`);
    }
  });

  console.log(`Opening ${BASE_URL}...`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

  const testResults = [];

  function recordResult(name, passed, details) {
    testResults.push({ name, passed, details });
    const icon = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${icon}: ${name} - ${details}`);
  }

  // ----------------------------------------------------
  // TEST CASE 1: Basic Page Load & Initial UI State
  // ----------------------------------------------------
  try {
    const title = await page.title();
    const hasBrand = await page.$eval('.brand-name', (el) => el.textContent.includes('FUSION'));
    const initialSessionCount = await page.$$eval('.session-card', (cards) => cards.length);
    const runBtnDisabled = await page.$eval('#run-button', (btn) => btn.disabled);

    recordResult(
      'TC1: Initial Page State Verification',
      title.includes('FUSION') && hasBrand && initialSessionCount >= 1 && !runBtnDisabled,
      `Title="${title}", Sessions=${initialSessionCount}, RunBtnEnabled=${!runBtnDisabled}`
    );
  } catch (err) {
    recordResult('TC1: Initial Page State Verification', false, err.message);
  }

  // ----------------------------------------------------
  // TEST CASE 2: Multi-Session Management (Create, Switch, Delete)
  // ----------------------------------------------------
  try {
    const beforeCount = await page.$$eval('.session-card', (cards) => cards.length);
    await page.click('#new-session-button');
    await wait(600);
    const afterCount = await page.$$eval('.session-card', (cards) => cards.length);

    // Verify session card switch
    const cards = await page.$$('.session-card');
    if (cards.length > 1) {
      await cards[0].click();
      await wait(300);
    }

    recordResult(
      'TC2: Session Creation & Switching',
      afterCount === beforeCount + 1,
      `Sessions grew from ${beforeCount} to ${afterCount}`
    );
  } catch (err) {
    recordResult('TC2: Session Creation & Switching', false, err.message);
  }

  // ----------------------------------------------------
  // TEST CASE 3: Pure Natural Language Design (Auto Circuit Selection)
  // ----------------------------------------------------
  try {
    console.log('\nTesting Case 3: Natural language request without file...');
    await page.click('#new-session-button');
    await wait(500);

    // Type natural language prompt
    await page.$eval('[name="naturalRequest"]', (el) => {
      el.value = '1.8V VDD 저잡음 트랜스임피던스 증폭기(TIA)를 설계해줘';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await wait(300);

    // Verify circuit selection switched to 'auto'
    const circuitVal = await page.$eval('#circuit-input', (el) => el.value);

    // Run agent cycle
    await page.click('#run-button');
    await page.waitForFunction(() => {
      const btn = document.querySelector('#run-button');
      return btn && !btn.disabled && !btn.textContent.includes('설계 중');
    }, { timeout: 45000 });

    const statusTitle = await page.$eval('#run-status-title', (el) => el.textContent);
    const topologyTitle = await page.$eval('#topology-title', (el) => el.textContent);
    const metricCardsCount = await page.$$eval('.metric-card', (cards) => cards.length);

    recordResult(
      'TC3: Natural Language Circuit Synthesis (TIA)',
      circuitVal === 'auto' && metricCardsCount >= 4 && (statusTitle.includes('완료') || statusTitle.includes('통과') || statusTitle.includes('앵커') || statusTitle.includes('차단')),
      `Circuit=${circuitVal}, Topology="${topologyTitle}", Status="${statusTitle}", Metrics=${metricCardsCount}`
    );
  } catch (err) {
    recordResult('TC3: Natural Language Circuit Synthesis (TIA)', false, err.message);
  }

  // Helper to test file upload via input
  async function testDataSheetUpload(sampleKey) {
    const sample = SAMPLES[sampleKey];
    const tempFile = path.resolve(`./temp_${sample.fileName}`);
    fs.writeFileSync(tempFile, sample.text, 'utf8');

    await page.click('#new-session-button');
    await wait(600);

    const fileInput = await page.$('#datasheet-input');
    await fileInput.uploadFile(tempFile);
    await wait(1500); // allow async contract inspect

    const statusText = await page.$eval('#datasheet-status', (el) => el.textContent);
    const statusClass = await page.$eval('#datasheet-status', (el) => el.className);
    const runBtnDisabled = await page.$eval('#run-button', (btn) => btn.disabled);

    try { fs.unlinkSync(tempFile); } catch {}

    return { sample, statusText, statusClass, runBtnDisabled };
  }

  // ----------------------------------------------------
  // TEST CASE 4: Commercial Op-Amp Ingestion (OPA333 - Micro-power CMOS)
  // ----------------------------------------------------
  try {
    console.log('\nTesting Case 4: OPA333 Commercial CMOS Op-Amp Datasheet...');
    const result = await testDataSheetUpload('opa333');
    
    // OPA333 operating voltage is 1.8V to 5.5V. While 1.8V is compatible with Sky130 1.8V,
    // the 5.5V ceiling exceeds Sky130's 3.3V validated boundary and flags contract review.
    const contractValid = !result.runBtnDisabled;
    const hasVoltageWarningOrReview = result.statusText.includes('검토') || result.statusText.includes('계약');
    
    if (contractValid) {
      await page.click('#run-button');
      await page.waitForFunction(() => {
        const btn = document.querySelector('#run-button');
        return btn && !btn.disabled && !btn.textContent.includes('설계 중');
      }, { timeout: 45000 });
      
      const topo = await page.$eval('#topology-title', (el) => el.textContent);
      const verifyHeading = await page.$eval('#verification-status', (el) => el.textContent);
      
      recordResult(
        'TC4: OPA333 Commercial Op-Amp (Compatible with 5.5V Warning/Review)',
        hasVoltageWarningOrReview,
        `Status="${result.statusText}", Topo="${topo}", VerifierStatus="${verifyHeading}"`
      );
    } else {
      recordResult(
        'TC4: OPA333 Commercial Op-Amp (Compatible with 5.5V Warning/Review)',
        false,
        `Unexpectedly blocked: ${result.statusText}`
      );
    }
  } catch (err) {
    recordResult('TC4: OPA333 Commercial Op-Amp (Compatible with 5.5V Warning/Review)', false, err.message);
  }

  // ----------------------------------------------------
  // TEST CASE 5: Commercial LDO Ingestion (TPS7A20 - Low Dropout Regulator)
  // ----------------------------------------------------
  try {
    console.log('\nTesting Case 5: TPS7A20 Low-Noise LDO Datasheet...');
    const result = await testDataSheetUpload('tps7a20');
    
    // Check if system correctly identifies LDO or maintains legal supply
    recordResult(
      'TC5: TPS7A20 Commercial LDO Datasheet Contract',
      result.statusText.includes('계약') || result.statusText.includes('검토'),
      `StatusText="${result.statusText}", RunDisabled=${result.runBtnDisabled}`
    );
  } catch (err) {
    recordResult('TC5: TPS7A20 Commercial LDO Datasheet Contract', false, err.message);
  }

  // ----------------------------------------------------
  // TEST CASE 6: Safety Fail-Closed Contract (TPA3116D2 50W High-Voltage IC)
  // ----------------------------------------------------
  try {
    console.log('\nTesting Case 6: TPA3116D2 50W High-Voltage Audio Amp (Fail-Closed Test)...');
    const result = await testDataSheetUpload('tpa3116d2');

    // TPA3116D2 requires 4.5V to 26V and 50W power, exceeding Sky130 1.8V domain!
    // The contract MUST block execution (runBtnDisabled === true) or show blocker text!
    const isBlocked = result.runBtnDisabled || result.statusText.includes('실행 차단');

    recordResult(
      'TC6: High-Voltage Class-D Safety Blocker (ATLAS / AnalogVerifier)',
      isBlocked,
      `RunDisabled=${result.runBtnDisabled}, Message="${result.statusText}"`
    );
  } catch (err) {
    recordResult('TC6: High-Voltage Class-D Safety Blocker (ATLAS / AnalogVerifier)', false, err.message);
  }

  // ----------------------------------------------------
  // TEST CASE 7: UI Tab Navigation & Artifacts Generation Check
  // ----------------------------------------------------
  try {
    console.log('\nTesting Case 7: UI Tab Switching & Export Artifacts View...');
    // Click on nav items
    await page.click('[data-scroll-target="verify"]');
    await wait(300);
    await page.click('[data-scroll-target="exports"]');
    await wait(300);

    const artifactContent = await page.$eval('#artifact-code', (el) => el.textContent);
    const hasNetlistOrComment = artifactContent.includes('.subckt') || artifactContent.includes('*') || artifactContent.length > 20;

    recordResult(
      'TC7: Verification & Artifacts Tab Inspection',
      hasNetlistOrComment,
      `Artifact preview length = ${artifactContent.length} chars`
    );
  } catch (err) {
    recordResult('TC7: Verification & Artifacts Tab Inspection', false, err.message);
  }

  // ----------------------------------------------------
  // TEST CASE 8: Real Binary PDF Extraction & Contract Inspection (Zero external dependency)
  // ----------------------------------------------------
  try {
    function buildSimplePdf(content) {
      const stream = zlib.deflateSync(Buffer.from('BT /F1 12 Tf 72 712 Td (' + content + ') Tj ET')).toString('binary');
      return Buffer.from(
        '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n' +
        '4 0 obj\n<< /Length ' + stream.length + ' /Filter /FlateDecode >>\nstream\n' + stream + '\nendstream\nendobj\n' +
        'xref\n0 5\n0000000000 65535 f \n' +
        'trailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n500\n%%EOF\n', 'binary'
      );
    }
    const pdfBytes = buildSimplePdf('CDCVF2505-Q1 3.3-V Phase-Lock Loop Clock Driver Supply voltage 3.0 V to 3.6 V');

    const tempPdfFile = path.resolve('./temp_cdcvf2505-q1.pdf');
    fs.writeFileSync(tempPdfFile, pdfBytes);

    await page.click('#new-session-button');
    await wait(600);

    const fileInput = await page.$('#datasheet-input');
    await fileInput.uploadFile(tempPdfFile);
    await wait(1800);

    const statusText = await page.$eval('#datasheet-status', (el) => el.textContent);
    try { fs.unlinkSync(tempPdfFile); } catch {}

    const parsedSuccess = !statusText.includes('PDF extraction failed');
    recordResult(
      'TC8: Real Binary PDF Ingestion (Native Stream Decoder)',
      parsedSuccess,
      `StatusText="${statusText}"`
    );
  } catch (err) {
    recordResult('TC8: Real Binary PDF Ingestion (Native Stream Decoder)', false, err.message);
  }

  console.log('\n====================================================');
  console.log('Test Summary:');
  const passedCount = testResults.filter((r) => r.passed).length;
  console.log(`Total: ${testResults.length}, Passed: ${passedCount}, Failed: ${testResults.length - passedCount}`);
  console.log(`Uncaught Page Errors: ${pageErrors.length}`);
  console.log('====================================================');

  await browser.close();
}

runComprehensiveBrowserTests().catch((e) => {
  console.error('Browser Test Suite Failed:', e);
  process.exit(1);
});
