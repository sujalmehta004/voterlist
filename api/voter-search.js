const https = require('https');
const JSON5 = require('json5');
const { hasValidSession } = require('../lib/auth');

function makeRequest(url, options, postData = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      method: options.method || 'GET',
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: options.headers || {},
    };

    const req = https.request(reqOptions, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString()
        });
      });
    });

    req.on('error', reject);
    // timeout in ms (default 10s) to avoid hanging requests
    const timeoutMs = (options && options.timeout) || 10000;
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timed out'));
    });
    if (postData) req.write(postData);
    req.end();
  });
}

function extractVoterJsonObject(html) {
  const marker = "newEnrollmentController(";
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;

  const startIdx = html.indexOf('{', markerIdx);
  if (startIdx === -1) return null;

  let braceCount = 0;
  for (let i = startIdx; i < html.length; i++) {
    if (html[i] === '{') {
      braceCount++;
    } else if (html[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        const jsonStr = html.substring(startIdx, i + 1);
        try {
          return JSON5.parse(jsonStr);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Province names (province IDs 1-7 are stable and hardcoded)
const NEPAL_PROVINCES = {
  "1": { en: "Koshi",          np: "कोशी" },
  "2": { en: "Madhesh",        np: "मधेश" },
  "3": { en: "Bagmati",        np: "बागमती" },
  "4": { en: "Gandaki",        np: "गण्डकी" },
  "5": { en: "Lumbini",        np: "लुम्बिनी" },
  "6": { en: "Karnali",        np: "कर्णाली" },
  "7": { en: "Sudurpashchim",  np: "सुदूरपश्चिम" },
};

// Nepali district name → English name lookup
// Used because the election portal only returns Nepali district names
const DISTRICT_NP_TO_EN = {
  "ताप्लेजुङ":"Taplejung","पाँचथर":"Panchthar","इलाम":"Ilam","झापा":"Jhapa",
  "मोरङ":"Morang","सुनसरी":"Sunsari","धनकुटा":"Dhankuta","तेह्रथुम":"Terhathum",
  "सङ्खुवासभा":"Sankhuwasabha","भोजपुर":"Bhojpur","सोलुखुम्बु":"Solukhumbu",
  "ओखलढुंगा":"Okhaldhunga","खोटाङ":"Khotang","उदयपुर":"Udayapur",
  "सप्तरी":"Saptari","सिरहा":"Siraha","धनुषा":"Dhanusa","महोत्तरी":"Mahottari",
  "सर्लाही":"Sarlahi","सिन्धुली":"Sindhuli","रामेछाप":"Ramechhap","दोलखा":"Dolakha",
  "सिन्धुपाल्चोक":"Sindhupalchok","काभ्रेपलान्चोक":"Kavrepalanchok",
  "ललितपुर":"Lalitpur","भक्तपुर":"Bhaktapur","काठमाडौं":"Kathmandu",
  "नुवाकोट":"Nuwakot","रसुवा":"Rasuwa","धादिङ":"Dhading","मकवानपुर":"Makwanpur",
  "रौतहट":"Rautahat","बारा":"Bara","पर्सा":"Parsa","चितवन":"Chitwan",
  "गोर्खा":"Gorkha","लमजुङ":"Lamjung","तनहुँ":"Tanahu","स्याङ्जा":"Syangja",
  "कास्की":"Kaski","मनाङ":"Manang","मुस्ताङ":"Mustang","म्याग्दी":"Myagdi",
  "पर्वत":"Parbat","बाग्लुङ":"Baglung","गुल्मी":"Gulmi","पाल्पा":"Palpa",
  "नवलपरासी":"Nawalparasi","रुपन्देही":"Rupandehi","कपिलवस्तु":"Kapilbastu",
  "अर्घाखाँची":"Arghakhanchi","प्युठान":"Pyuthan","रोल्पा":"Rolpa",
  "रुकुम":"Rukum","सल्यान":"Salyan","दाङ":"Dang","बाँके":"Banke",
  "बर्दिया":"Bardiya","सुर्खेत":"Surkhet","दैलेख":"Dailekh","जाजरकोट":"Jajarkot",
  "डोल्पा":"Dolpa","जुम्ला":"Jumla","कालिकोट":"Kalikot","मुगु":"Mugu",
  "हुम्ला":"Humla","बाजुरा":"Bajura","बझाङ":"Bajhang","अछाम":"Achham",
  "डोटी":"Doti","कैलाली":"Kailali","कञ्चनपुर":"Kanchanpur","डडेल्धुरा":"Dadeldhura",
  "बैतडी":"Baitadi","दार्चुला":"Darchula",
};



module.exports = async (req, res) => {
  if (typeof res.status !== 'function') {
    res.status = function (s) { this.statusCode = s; return this; };
  }
  if (typeof res.json !== 'function') {
    res.json = function (d) {
      this.setHeader('Content-Type', 'application/json');
      this.end(JSON.stringify(d));
      return this;
    };
  }

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    if (!await hasValidSession(req, res)) return res.status(401).json({ error: "Sign in to run a voter search." });
  } catch (error) {
    console.error('Voter search authentication failed:', error.message);
    return res.status(500).json({ error: "Authentication is temporarily unavailable." });
  }

  const { nin, dob, firstname } = req.body || {};
  if (!nin || !dob || !firstname) {
    return res.status(400).json({ error: "Missing required body parameters (nin, dob, firstname)" });
  }

  let formattedNin = nin.replace(/[^0-9]/g, "");
  if (formattedNin.length === 10) {
    formattedNin = `${formattedNin.slice(0,3)}-${formattedNin.slice(3,6)}-${formattedNin.slice(6,9)}-${formattedNin.slice(9)}`;
  } else {
    formattedNin = nin.trim();
  }

  const formattedDob = dob.replace(/\//g, "-").trim();
  const formattedFirstname = firstname.toLowerCase().trim();

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

  try {
    // Parallel approach: create multiple independent sessions and POST GetFromNIN concurrently
    const requestedParallel = parseInt(req.body.parallelCount || req.query && req.query.parallel || 10, 10) || 10;
    const parallelCount = Math.min(20, Math.max(1, requestedParallel));

    const makeAttempt = async (fnameCandidate) => {
      try {
        // new session per attempt
        const s1 = await makeRequest('https://applyvr.election.gov.np/Login/Preregistration/EnterMobileNo', {
          method: 'GET',
          headers: { 'User-Agent': UA, 'Accept': 'text/html' },
          timeout: 10000
        });
        const sc = s1.headers && s1.headers['set-cookie'];
        if (!sc || !Array.isArray(sc) || sc.length === 0) return { ok: false, reason: 'no-cookie' };
        const cookieStr = sc.join('; ');

        const hdrs = { 'Cookie': cookieStr, 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' };
        const postUrl = `https://applyvr.election.gov.np/Login/GetFromNIN?NIN=${encodeURIComponent(formattedNin)}&dob=${encodeURIComponent(formattedDob)}&firstname=${encodeURIComponent(fnameCandidate)}`;
        const p = await makeRequest(postUrl, {
          method: 'POST',
          headers: { ...hdrs, 'Content-Length': '0', 'Origin': 'https://applyvr.election.gov.np', 'Referer': 'https://applyvr.election.gov.np/Login/Preregistration/EnterMobileNo' },
          timeout: 10000
        });
        let json = null;
        try { json = JSON.parse(p.body); } catch (e) { json = null; }

        // If json indicates data present, return it
        if (json && json.data && json.status === 1) return { ok: true, type: 'json', data: json, cookie: cookieStr };

        // If portal indicates already registered, try to GET dashboard and extract prefilled JSON
        if (( !json || !json.data || json.status !== 1 ) && typeof (json && json.message) === 'string') {
          const step3 = await makeRequest('https://applyvr.election.gov.np/Dashboard/NewEnrollment', {
            method: 'GET',
            headers: { 'Cookie': cookieStr, 'User-Agent': UA, 'Referer': 'https://applyvr.election.gov.np/Login/Preregistration/EnterMobileNo' },
            timeout: 10000
          });
          const parsed = extractVoterJsonObject(step3.body);
          if (parsed) return { ok: true, type: 'parsed', data: parsed, cookie: cookieStr };
        }

        return { ok: false, body: p.body, json };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    };

    const candidates = [];
    if (formattedFirstname && !/^[0-9\-/]{2,}$/.test(formattedFirstname)) candidates.push(formattedFirstname);
    candidates.push('sujal');
    candidates.push('');
    while (candidates.length < parallelCount) candidates.push('sujal' + Math.floor(Math.random() * 10000));

    const attemptPromises = candidates.slice(0, parallelCount).map(c => makeAttempt(c));
    const results = await Promise.all(attemptPromises);
    const successResult = results.find(r => r.ok === true);
    let step2 = null;
    let step2Json = null;
    let sessionCookie = null;
    if (successResult) {
      if (successResult.type === 'parsed') {
        const parsedDirect = successResult.data;
        parsedDirect._note = 'extracted_from_new_enrollment_parallel_attempt';
        const provIdDirect = String(parsedDirect.ProvinceId || parsedDirect.ProvinceCode || parsedDirect.PermanentState || "");
        const provInfoDirect = NEPAL_PROVINCES[provIdDirect] || { en: `Province ${provIdDirect}`, np: `प्रदेश ${provIdDirect}` };
        parsedDirect.PermanentStateNameEn = provInfoDirect.en;
        parsedDirect.PermanentStateNameNp = provInfoDirect.np;
        if (parsedDirect.WardNo !== undefined && parsedDirect.WardNo !== null) parsedDirect.PermanentWard = String(parsedDirect.WardNo || "");
        parsedDirect.PermanentDistrict = parseInt(parsedDirect.DistrictId || parsedDirect.DistrictCode || parsedDirect.PermanentDistrict || 0, 10);
        parsedDirect.PermanentVdcMunicipality = parseInt(parsedDirect.VdcMunicipalityId || parsedDirect.PermanentVdcMunicipality || 0, 10);
        parsedDirect.PermanentState = provIdDirect;
        return res.status(200).json({ success: true, data: parsedDirect });
      }
      if (successResult.type === 'json') {
        step2Json = successResult.data;
        sessionCookie = successResult.cookie;
      }
    } else {
      // no success — try to pick a json error if any result had json with message
      const anyJson = results.find(r => r.json && typeof r.json.message === 'string');
      if (anyJson) {
        step2Json = anyJson.json;
      } else {
        return res.status(500).json({ error: "NID सर्भरबाट डेटा प्राप्त हुन सकेन। कृपया केही समयपछि पुनः प्रयास गर्नुहोस्।", details: results.slice(0,5) });
      }
    }

    // build authHeaders for downstream API calls
    const authHeaders = {
      'Cookie': sessionCookie || '' ,
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest'
    };

    // If the portal reports the record exists (already registered) the portal often returns data:false with
    // a Nepali message like "तपाईको निवेदन स्वीकृत भइसकेको छ ... मतदाता नं ...". In that case attempt two fallbacks:
    // 1) Try to GET the NewEnrollment page directly and extract the prefilled JSON (some sessions allow this).
    // 2) If that fails, retry the GetFromNIN POST with an alternate firstname (use provided firstname unless it
    //    looks like a date/garbage; fallback to 'sujal' which is known to trigger new-enrollment path in the portal).

    const alreadyRegisteredMsgRegex = /निवेदन स्वीकृत|मतदाता\s*न\.?/i;

    if (( !step2Json || (!step2Json.data || step2Json.status !== 1) ) && typeof (step2Json && step2Json.message) === 'string' && alreadyRegisteredMsgRegex.test(step2Json.message)) {
      // The portal indicates the record is already registered (often with a Nepali message).
      // Try forcing the full payload by directly GETting the NewEnrollment dashboard first —
      // this is the most reliable way to obtain the prefilled JSON when the session already
      // has data associated with the NIN (user requested "forceful" fetch).
      try {
        const step3Direct = await makeRequest('https://applyvr.election.gov.np/Dashboard/NewEnrollment', {
          method: 'GET',
          headers: { 'Cookie': sessionCookie, 'User-Agent': UA, 'Referer': 'https://applyvr.election.gov.np/Login/Preregistration/EnterMobileNo' }
        });
        const parsedDirect = extractVoterJsonObject(step3Direct.body);
        if (parsedDirect) {
          parsedDirect._note = 'extracted_from_new_enrollment_directly_initial_attempt';
          console.log('[voter-search] Extracted voter profile from initial enrollment session.');
          const provIdDirect = String(parsedDirect.ProvinceId || parsedDirect.ProvinceCode || parsedDirect.PermanentState || "");
          const provInfoDirect = NEPAL_PROVINCES[provIdDirect] || { en: `Province ${provIdDirect}`, np: `प्रदेश ${provIdDirect}` };
          parsedDirect.PermanentStateNameEn = provInfoDirect.en;
          parsedDirect.PermanentStateNameNp = provInfoDirect.np;
          if (parsedDirect.WardNo !== undefined && parsedDirect.WardNo !== null) parsedDirect.PermanentWard = String(parsedDirect.WardNo || "");
          parsedDirect.PermanentDistrict = parseInt(parsedDirect.DistrictId || parsedDirect.DistrictCode || parsedDirect.PermanentDistrict || 0, 10);
          parsedDirect.PermanentVdcMunicipality = parseInt(parsedDirect.VdcMunicipalityId || parsedDirect.PermanentVdcMunicipality || 0, 10);
          parsedDirect.PermanentState = provIdDirect;
          return res.status(200).json({ success: true, data: parsedDirect });
        }
      } catch (e) {
        console.error('Direct NewEnrollment initial fetch failed:', e.message);
      }

      // Try refreshing the session cookie and re-requesting Dashboard/NewEnrollment —
      // some portal sessions only return the prefilled payload after a fresh session is established.
      try {
        const refresh = await makeRequest('https://applyvr.election.gov.np/Login/Preregistration/EnterMobileNo', {
          method: 'GET',
          headers: { 'User-Agent': UA, 'Accept': 'text/html' },
          timeout: 10000
        });
        const setCookie2 = refresh.headers && refresh.headers['set-cookie'];
        if (setCookie2) {
          const sessionCookieMatch2 = setCookie2.join('; ').match(/\.AdventureWorks\.Session=[^;]+/);
          // prefer AdventureWorks cookie if present, otherwise use full set-cookie
          if (sessionCookieMatch2) {
            const sessionCookie2 = sessionCookieMatch2[0] || setCookie2.join('; ');
            try {
              const step3Refreshed = await makeRequest('https://applyvr.election.gov.np/Dashboard/NewEnrollment', {
                method: 'GET',
                headers: { 'Cookie': sessionCookie2, 'User-Agent': UA, 'Referer': 'https://applyvr.election.gov.np/Login/Preregistration/EnterMobileNo' },
                timeout: 10000
              });
              const parsedRefreshed = extractVoterJsonObject(step3Refreshed.body);
              if (parsedRefreshed) {
                parsedRefreshed._note = 'extracted_from_new_enrollment_after_session_refresh';
              console.log('[voter-search] Extracted voter profile after refreshing the session.');
              const provIdRef = String(parsedRefreshed.ProvinceId || parsedRefreshed.ProvinceCode || parsedRefreshed.PermanentState || "");
              const provInfoRef = NEPAL_PROVINCES[provIdRef] || { en: `Province ${provIdRef}`, np: `प्रदेश ${provIdRef}` };
              parsedRefreshed.PermanentStateNameEn = provInfoRef.en;
              parsedRefreshed.PermanentStateNameNp = provInfoRef.np;
              if (parsedRefreshed.WardNo !== undefined && parsedRefreshed.WardNo !== null) parsedRefreshed.PermanentWard = String(parsedRefreshed.WardNo || "");
              parsedRefreshed.PermanentDistrict = parseInt(parsedRefreshed.DistrictId || parsedRefreshed.DistrictCode || parsedRefreshed.PermanentDistrict || 0, 10);
              parsedRefreshed.PermanentVdcMunicipality = parseInt(parsedRefreshed.VdcMunicipalityId || parsedRefreshed.PermanentVdcMunicipality || 0, 10);
              parsedRefreshed.PermanentState = provIdRef;
              return res.status(200).json({ success: true, data: parsedRefreshed });
              }
            } catch (e) {
              console.error('Refreshed-session NewEnrollment fetch failed:', e.message);
            }
          } else {
            // no AdventureWorks-specific cookie; attempt using full cookie string
            const sessionCookie2 = setCookie2.join('; ');
            try {
              const step3Refreshed = await makeRequest('https://applyvr.election.gov.np/Dashboard/NewEnrollment', {
                method: 'GET',
                headers: { 'Cookie': sessionCookie2, 'User-Agent': UA, 'Referer': 'https://applyvr.election.gov.np/Login/Preregistration/EnterMobileNo' },
                timeout: 10000
              });
              const parsedRefreshed = extractVoterJsonObject(step3Refreshed.body);
              if (parsedRefreshed) {
                parsedRefreshed._note = 'extracted_from_new_enrollment_after_session_refresh_using_full_cookie';
                console.log('[voter-search] Extracted voter profile after refreshing the full session cookie.');
                const provIdRef = String(parsedRefreshed.ProvinceId || parsedRefreshed.ProvinceCode || parsedRefreshed.PermanentState || "");
                const provInfoRef = NEPAL_PROVINCES[provIdRef] || { en: `Province ${provIdRef}`, np: `प्रदेश ${provIdRef}` };
                parsedRefreshed.PermanentStateNameEn = provInfoRef.en;
                parsedRefreshed.PermanentStateNameNp = provInfoRef.np;
                if (parsedRefreshed.WardNo !== undefined && parsedRefreshed.WardNo !== null) parsedRefreshed.PermanentWard = String(parsedRefreshed.WardNo || "");
                parsedRefreshed.PermanentDistrict = parseInt(parsedRefreshed.DistrictId || parsedRefreshed.DistrictCode || parsedRefreshed.PermanentDistrict || 0, 10);
                parsedRefreshed.PermanentVdcMunicipality = parseInt(parsedRefreshed.VdcMunicipalityId || parsedRefreshed.PermanentVdcMunicipality || 0, 10);
                parsedRefreshed.PermanentState = provIdRef;
                return res.status(200).json({ success: true, data: parsedRefreshed });
              }
            } catch (e) {
              console.error('Refreshed-session NewEnrollment fetch using full cookie failed:', e.message);
            }
          }
        }
      } catch (e) {
        console.error('Session refresh failed:', e.message);
      }

      // If direct GET didn't yield a payload, fall back to retrying GetFromNIN with alternate firstnames
      // (portal sometimes requires a particular firstname value to trigger the JSON response).
      const triedFirstnames = [];
      const candidates = [];
      if (formattedFirstname && !/^[0-9\-/]{2,}$/.test(formattedFirstname)) candidates.push(formattedFirstname);
      candidates.push('sujal');
      candidates.push('');

      let parsedAfterRetry = null;
      for (const cand of candidates) {
        if (triedFirstnames.indexOf(cand) !== -1) continue;
        triedFirstnames.push(cand);
        try {
          const fnameToUse = cand || 'sujal';
          const step2Retry = await makeRequest(
            `https://applyvr.election.gov.np/Login/GetFromNIN?NIN=${encodeURIComponent(formattedNin)}&dob=${encodeURIComponent(formattedDob)}&firstname=${encodeURIComponent(fnameToUse)}`,
            { method: 'POST', headers: { ...authHeaders, 'Content-Length': '0', 'Origin': 'https://applyvr.election.gov.np', 'Referer': 'https://applyvr.election.gov.np/Login/Preregistration/EnterMobileNo' } }
          );

          let retryJson = null;
          try { retryJson = JSON.parse(step2Retry.body); } catch (e) { retryJson = null; }

          if (retryJson && retryJson.data) {
            try {
              const step3 = await makeRequest('https://applyvr.election.gov.np/Dashboard/NewEnrollment', {
                method: 'GET',
                headers: { 'Cookie': sessionCookie, 'User-Agent': UA, 'Referer': 'https://applyvr.election.gov.np/Login/Preregistration/EnterMobileNo' }
              });
              const parsed = extractVoterJsonObject(step3.body);
              if (parsed) {
                parsedAfterRetry = parsed;
                parsedAfterRetry._note = 'extracted_after_retry_getfromnin_' + fnameToUse;
              console.log('[voter-search] Extracted voter profile after retrying the NIN lookup.');
              break;
              }
            } catch (e) {
              console.error('Fetch NewEnrollment after retry failed:', e.message);
            }
          }
        } catch (e) {
          console.error('GetFromNIN retry attempt failed:', e.message);
        }
      }

      if (parsedAfterRetry) {
        const provId = String(parsedAfterRetry.ProvinceId || parsedAfterRetry.ProvinceCode || parsedAfterRetry.PermanentState || "");
        const provInfo = NEPAL_PROVINCES[provId] || { en: `Province ${provId}`, np: `प्रदेश ${provId}` };
        parsedAfterRetry.PermanentStateNameEn = provInfo.en;
        parsedAfterRetry.PermanentStateNameNp = provInfo.np;
        if (parsedAfterRetry.WardNo !== undefined && parsedAfterRetry.WardNo !== null) parsedAfterRetry.PermanentWard = String(parsedAfterRetry.WardNo || "");
        parsedAfterRetry.PermanentDistrict = parseInt(parsedAfterRetry.DistrictId || parsedAfterRetry.DistrictCode || parsedAfterRetry.PermanentDistrict || 0, 10);
        parsedAfterRetry.PermanentVdcMunicipality = parseInt(parsedAfterRetry.VdcMunicipalityId || parsedAfterRetry.PermanentVdcMunicipality || 0, 10);
        parsedAfterRetry.PermanentState = provId;
        return res.status(200).json({ success: true, data: parsedAfterRetry });
      }

      // None of the fallbacks worked — return the original portal message to the caller (with a helpful hint)
      return res.status(404).json({ error: step2Json.message || "Record not found or verification failed.", hint: "Tried direct NewEnrollment fetch, then alternate firstnames and direct dashboard fetch to force new enrollment" });
    }

    if (!step2Json.data || step2Json.status !== 1) {
      return res.status(404).json({ error: step2Json.message || "Record not found or verification failed." });
    }

    // Step 3: GET NewEnrollment dashboard page
    const step3 = await makeRequest('https://applyvr.election.gov.np/Dashboard/NewEnrollment', {
      method: 'GET',
      headers: { 'Cookie': sessionCookie, 'User-Agent': UA, 'Referer': 'https://applyvr.election.gov.np/Login/Preregistration/EnterMobileNo' }
    });

    const parsedData = extractVoterJsonObject(step3.body);
    if (!parsedData) return res.status(500).json({ error: "Failed to extract voter information from dashboard page" });

    // ── Province ─────────────────────────────────────────────────────────────
    const provId = String(parsedData.ProvinceId || parsedData.ProvinceCode || parsedData.PermanentState || "");
    const provInfo = NEPAL_PROVINCES[provId] || { en: `Province ${provId}`, np: `प्रदेश ${provId}` };
    parsedData.PermanentStateNameEn = provInfo.en;
    parsedData.PermanentStateNameNp = provInfo.np;

    // ── District ─────────────────────────────────────────────────────────────
    // Portal uses DistrictId (e.g. 10 = Sunsari) — NOT the standard 1-77 geographic numbering
    const distId = parseInt(parsedData.DistrictId || parsedData.DistrictCode || parsedData.PermanentDistrict || 0, 10);

    if (distId && provId) {
      try {
        // Fetch from portal using the LIVE session (still valid right after NewEnrollment)
        const distRes = await makeRequest(
          `https://applyvr.election.gov.np/Api/RegistrationApi/GetDistrictByProvince?provinceId=${provId}`,
          { method: 'GET', headers: { ...authHeaders, 'Referer': 'https://applyvr.election.gov.np/Dashboard/NewEnrollment' } }
        );
        const distBody = JSON.parse(distRes.body);
        // Response format: { data: [{id, name, code}], status:1 }
        // The "name" field is Nepali only (e.g. "सुनसरी")
        const distList = Array.isArray(distBody) ? distBody : (distBody.data || []);
        const distMatch = distList.find(d => String(d.id || "") === String(distId));
        if (distMatch) {
          const distNameNp = distMatch.name || "";   // e.g. "सुनसरी"
          parsedData.PermanentDistrictNameNp = distNameNp;
          // Resolve English name via our Nepali→English lookup
          parsedData.PermanentDistrictNameEn = DISTRICT_NP_TO_EN[distNameNp] || distNameNp;
        }
      } catch (e) {
        console.error("District API error:", e.message);
      }
    }

    // ── Municipality ─────────────────────────────────────────────────────────
    // Portal uses VdcMunicipalityId (e.g. 5093)
    // Response format: { data: [{id, name, code}], status:1 }
    // "name" is Nepali with suffix already included (e.g. "इनरुवा नगरपालिका")
    const muniId = parseInt(parsedData.VdcMunicipalityId || parsedData.PermanentVdcMunicipality || 0, 10);

    if (muniId && distId) {
      try {
        const muniRes = await makeRequest(
          `https://applyvr.election.gov.np/Api/RegistrationApi/GetMunicipalities?DistrictId=${distId}`,
          { method: 'GET', headers: { ...authHeaders, 'Referer': 'https://applyvr.election.gov.np/Dashboard/NewEnrollment' } }
        );
        const muniBody = JSON.parse(muniRes.body);
        const muniList = Array.isArray(muniBody) ? muniBody : (muniBody.data || []);
        const muniMatch = muniList.find(m => String(m.id || "") === String(muniId));

        if (muniMatch) {
          // Portal returns Nepali full name with suffix (e.g. "इनरुवा नगरपालिका")
          const muniNameNp = muniMatch.name || "";
          parsedData.PermanentVdcMunicipalityNameNp = muniNameNp;

          // Detect type suffix to get English equivalent
          const MUNI_SUFFIX_MAP = [
            { np: "महानगरपालिका",   en: "Metropolitan City" },
            { np: "उपमहानगरपालिका", en: "Sub-Metropolitan City" },
            { np: "नगरपालिका",      en: "Municipality" },
            { np: "गाउँपालिका",     en: "Rural Municipality" },
          ];
          let muniTypeEn = "";
          for (const { np, en } of MUNI_SUFFIX_MAP) {
            if (muniNameNp.endsWith(np)) {
              muniTypeEn = en;
              parsedData._muniCode    = muniMatch.code || "";  // e.g. "10-2"
              parsedData._muniTypeEn  = en;
              parsedData._muniTypeNp  = np;
              break;
            }
          }

          // Try to get English name from GitHub open dataset by matching the VdcMunicipalityCode
          // The code format is "distId-localIdx" (e.g. "10-2")
          let muniNameEn = "";
          try {
            const ghRes = await makeRequest(
              'https://raw.githubusercontent.com/bibekoli/local-levels-of-nepal-dataset/main/local_levels.json',
              { method: 'GET', headers: { 'User-Agent': 'NID-Portal/1.0' } }
            );
            const localLevels = JSON.parse(ghRes.body);
            // Match by Nepali name (strip the type suffix to get base name)
            let baseNp = muniNameNp;
            for (const { np } of MUNI_SUFFIX_MAP) {
              if (baseNp.endsWith(np)) { baseNp = baseNp.slice(0, -np.length).trim(); break; }
            }
            // Find by nepali_name match (base without suffix)
            const found = localLevels.find(m =>
              m.nepali_name && (m.nepali_name === baseNp || m.nepali_name === muniNameNp)
            );
            if (found && found.name) {
              muniNameEn = found.name + (muniTypeEn ? " " + muniTypeEn : "");
            }
          } catch (e) {
            // GitHub fetch failed — fall back to Nepali name
          }

          parsedData.PermanentVdcMunicipalityNameEn = muniNameEn || muniNameNp;
        }
      } catch (e) {
        console.error("Municipality API error:", e.message);
      }
    }

    // Ward
    if (parsedData.WardNo !== undefined && parsedData.WardNo !== null) {
      parsedData.PermanentWard = String(parsedData.WardNo || "");
    }

    // Normalise canonical IDs for the frontend
    parsedData.PermanentDistrict = distId;
    parsedData.PermanentVdcMunicipality = muniId;
    parsedData.PermanentState = provId;

    return res.status(200).json({ success: true, data: parsedData });

  } catch (err) {
    return res.status(500).json({ error: "Internal server error during voter search proxy", details: err.message });
  }
};
