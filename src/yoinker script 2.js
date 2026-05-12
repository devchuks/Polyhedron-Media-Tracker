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

        const regex = /^(?:\d+\.\s*)?(.+?)\s*\((\d{4})(?:-\d{4})?\)(.*)$/i;
        
        let currentItem = null;
        const itemsInTweet = [];

        // Scan every line in the tweet
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const match = line.match(regex);

          if (match) {
            // Found a new title. Save the previous one if it exists.
            if (currentItem) {
              itemsInTweet.push(currentItem);
            }

            // Start a new item
            currentItem = {
              rawText: line,
              rawTitle: match[1].trim(),
              parsedYear: parseInt(match[2], 10),
              parsedModifier: match[3].trim(),
              noteLines: []
            };
          } else {
            // Not a title. If we have a current item, this is a note/review for it.
            if (currentItem) {
              currentItem.noteLines.push(line);
            }
          }
        }

        // Push the final item from this tweet
        if (currentItem) {
          itemsInTweet.push(currentItem);
        }

        // Add all found items to our main Map
        itemsInTweet.forEach((item, index) => {
          // Because multiple items can come from the same tweet, append the index to make it unique
          const uniqueKey = tweetId 
            ? `${tweetId}_${index}` 
            : `${item.rawTitle}_${item.parsedYear}_${timestamp}_${index}`;

          if (!extracted.has(uniqueKey)) {
            extracted.set(uniqueKey, {
              id: crypto.randomUUID(),
              raw_text: item.rawText,
              extracted_title: item.rawTitle,
              parsed_year: item.parsedYear,
              parsed_modifier: item.parsedModifier,
              extracted_note: item.noteLines.join("\n\n"), // Joins multiple review lines cleanly
              tweet_timestamp: timestamp,
              source_tweet_id: tweetId || null,
              source_url: tweetLink || null,
              selected_type: null,
              status: "PENDING",
              candidates: []
            });

            console.log(`✅ Extracted: ${item.rawTitle} (${item.parsedYear})`);
          }
        });
        
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

  // Automatically trigger the file download
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

