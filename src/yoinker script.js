(async () => {
  console.log("🚀 Starting Twitter Yoinker...");
  console.log("⚠️ Keep this tab focused and do NOT scroll manually.");

  const extracted = new Map();

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const extractVisibleTweets = () => {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');

    tweets.forEach((tweet) => {
      try {
        const timeEl = tweet.querySelector("time");
        const timestamp = timeEl
          ? timeEl.getAttribute("datetime")
          : new Date().toISOString();

        const tweetLink = timeEl?.closest("a")?.href || "";
        const tweetId = tweetLink.split("/status/")[1]?.split("?")[0];

        const textEl = tweet.querySelector('div[data-testid="tweetText"]');
        if (!textEl) return;

        const lines = textEl.innerText
          .split("\n")
          .map(l => l.trim())
          .filter(Boolean);

        if (!lines.length) return;

        let signatureIndex = -1;
        let rawTitle = "";
        let parsedYear = null;
        let parsedModifier = "";

        const regex =
          /^(?:\d+\.\s*)?(.+?)\s*\((\d{4})(?:-\d{4})?\)(.*)$/i;

        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(regex);

          if (match) {
            signatureIndex = i;
            rawTitle = match[1].trim();
            parsedYear = parseInt(match[2], 10);
            parsedModifier = match[3].trim();
            break;
          }
        }

        if (signatureIndex === -1) return;

        const noteLines = lines.slice(signatureIndex + 1);

        const uniqueKey =
          tweetId ||
          `${rawTitle}_${parsedYear}_${timestamp}`;

        if (!extracted.has(uniqueKey)) {
          extracted.set(uniqueKey, {
            id: crypto.randomUUID(),

            raw_text: lines[signatureIndex],

            extracted_title: rawTitle,

            parsed_year: parsedYear,

            parsed_modifier: parsedModifier,

            extracted_note: noteLines.join("\n\n"),

            tweet_timestamp: timestamp,

            source_tweet_id: tweetId || null,

            source_url: tweetLink || null,

            selected_type: null,

            status: "PENDING",

            candidates: []
          });

          console.log(
            `✅ Extracted: ${rawTitle} (${parsedYear})`
          );
        }
      } catch (err) {
        console.warn("Tweet parse failed:", err);
      }
    });
  };

  let sameCount = 0;
  let lastExtractedCount = 0;

  while (sameCount < 8) {
    extractVisibleTweets();

    const currentCount = extracted.size;

    console.log(`📦 Current Extracted Count: ${currentCount}`);

    if (currentCount === lastExtractedCount) {
      sameCount++;
    } else {
      sameCount = 0;
      lastExtractedCount = currentCount;
    }

    window.scrollBy({
      top: window.innerHeight * 0.8,
      behavior: "smooth"
    });

    await sleep(2500);
  }

  const finalArray = Array.from(extracted.values());

  console.log("🎉 FINISHED!");
  console.log(`✅ Total Extracted: ${finalArray.length}`);

  console.log(JSON.stringify(finalArray, null, 2));

  const blob = new Blob(
    [JSON.stringify(finalArray, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `twitter_media_extract_${Date.now()}.json`;

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);

  console.log("💾 JSON downloaded automatically.");
})();