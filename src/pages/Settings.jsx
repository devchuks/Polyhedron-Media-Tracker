import React, { useState } from 'react';
import { Trash2, Download, Loader2, AlertTriangle } from 'lucide-react';
import { useMediaStore } from '../store/useMediaStore';
import { apiRegistry } from '../services/apiRegistry';

const DEMO_QUERIES = {
  movies: [
    "Children of Men", "The Prestige", "Drive", "Oldboy", "Memories of Murder",
    "The Handmaiden", "Perfect Blue", "Paprika", "The Truman Show", "Moonlight",
    "The Nice Guys", "Heat", "Collateral", "Uncut Gems", "The Florida Project",
    "There Will Be Blood", "The Favourite", "The Banshees of Inisherin", "Past Lives", "Aftersun",
    "Synecdoche, New York", "Beau Is Afraid", "Memento", "Zodiac", "The Raid",
    "Train to Busan", "Possession", "The Witch", "Raw", "Titane",
    "Climax", "Burning", "Decision to Leave", "Shoplifters", "Cure",
    "The Fall", "Pan's Labyrinth", "Children Who Chase Lost Voices", "Millennium Actress", "Perfect Days",
    "The Green Knight", "Pig", "Under the Silver Lake", "The Iron Claw", "The Brutalist",
    "Longlegs", "I Saw the TV Glow", "Poor Things", "The Substance", "Love Lies Bleeding"
  ],

  tv: [
    "Twin Peaks", "Utopia", "Legion", "Mr Inbetween", "Patriot",
    "The Leftovers", "Station Eleven", "Hannibal", "Black Sails", "Rectify",
    "Person of Interest", "Devs", "1899", "The OA", "Counterpart",
    "Pantheon", "Blue Eye Samurai", "Scavengers Reign", "Primal", "Love, Death & Robots",
    "The Terror", "From", "Midnight Mass", "Archive 81", "Channel Zero",
    "Nathan for You", "How To with John Wilson", "Review", "Party Down", "Silicon Valley",
    "Detectorists", "Flowers", "Reservation Dogs", "Pushing Daisies", "Wilfred",
    "Banshee", "Warrior", "Kingdom", "Gomorrah", "Tokyo Vice",
    "Dark Matter", "3 Body Problem", "Interview with the Vampire", "Ripley", "The Sympathizer",
    "Dorohedoro", "Pluto", "Heavenly Delusion", "Blue Eye Samurai", "Pantheon"
  ],

  games: [
    "Pathologic 2", "Signalis", "Nine Sols", "Fear & Hunger", "Fear & Hunger 2: Termina",
    "Library of Ruina", "Limbus Company", "Ultrakill", "Cruelty Squad", "Kenshi",
    "Rain World", "Noita", "Hyper Light Drifter", "Blasphemous", "Ender Lilies",
    "Library of Ruina", "Inscryption", "Slay the Spire", "Balatro", "Into the Breach",
    "The Talos Principle", "The Talos Principle 2", "The Stanley Parable", "Before Your Eyes", "To the Moon",
    "Omori", "Lisa: The Painful", "Hylics", "OFF", "Yume Nikki",
    "Nier Replicant", "Nier Automata", "Drakengard 3", "Shin Megami Tensei V", "Metaphor: ReFantazio",
    "Xenoblade Chronicles 3", "13 Sentinels: Aegis Rim", "Ace Combat 7", "Devil May Cry 5", "Monster Hunter Wilds",
    "Silent Hill 2", "Fatal Frame II", "Rule of Rose", "Parasite Eve", "System Shock",
    "Prey", "Dishonored 2", "Deus Ex", "Katana Zero", "Hotline Miami"
  ],

  anime: [
    "Serial Experiments Lain", "Texhnolyze", "Ergo Proxy", "Sonny Boy", "Tatami Galaxy",
    "Ping Pong the Animation", "Mononoke", "Paranoia Agent", "Kaiba", "Mawaru Penguindrum",
    "Revolutionary Girl Utena", "Angel's Egg", "Ghost in the Shell: Stand Alone Complex", "Planetes", "Space Dandy",
    "Odd Taxi", "Heavenly Delusion", "Pluto", "Devilman Crybaby", "Dorohedoro",
    "Land of the Lustrous", "Girls' Last Tour", "Mushishi", "Haibane Renmei", "Kino's Journey",
    "Baccano!", "Durarara!!", "Monogatari Series", "Welcome to the NHK", "March Comes in Like a Lion",
    "Legend of the Galactic Heroes", "Ashita no Joe", "Rainbow", "Kaiji", "Akagi",
    "Trigun Stampede", "86", "Vivy: Fluorite Eye's Song", "Summertime Rendering", "Link Click",
    "Blue Giant", "Look Back", "The Apothecary Diaries", "Orb: On the Movements of the Earth", "Dungeon Meshi",
    "Berserk 1997", "Gunbuster", "Diebuster", "FLCL", "Wolf's Rain"
  ],

  manga: [
    "Usogui", "Billy Bat", "Homunculus", "Fire Punch", "Ajin",
    "Dorohedoro", "Blame!", "Biomega", "Sun-Ken Rock", "The Climber",
    "Innocent", "Innocent Rouge", "Ultra Heaven", "Houseki no Kuni", "Jagaaaaaan",
    "Tokyo Ghoul:re", "Land of the Lustrous", "Dead Dead Demon's Dededede Destruction", "Real", "Holyland",
    "The Fable", "I Am a Hero", "Spirit Circle", "Lucifer and the Biscuit Hammer", "Helck",
    "Dungeon Meshi", "Witch Hat Atelier", "Frieren", "Girls' Last Tour", "Yokohama Kaidashi Kikou",
    "Aku no Hana", "Blood on the Tracks", "Inside Mari", "Happiness", "Chi no Wadachi",
    "Otoyomegatari", "A Bride's Story", "Golden Kamuy", "Touge Oni", "Smoking Behind the Supermarket with You",
    "Bokutachi ga Yarimashita", "Shimeji Simulation", "Goodbye, Eri", "Look Back", "Takopi's Original Sin",
    "Pandora Hearts", "The Summer Hikaru Died", "Gachiakuta", "Centuria", "Kindergarten Wars"
  ],

  vn: [
    "Wonderful Everyday", "Tsui no Sora", "Muramasa", "White Album 2", "Tsukihime -A piece of blue glass moon-",
    "Mahoutsukai no Yoru", "Full Metal Daemon Muramasa", "Subahibi", "Raging Loop", "428: Shibuya Scramble",
    "The Sekimeiya", "PARANORMASIGHT", "Slow Damage", "Sweet Pool", "Hashihime of the Old Book Town",
    "Flowers", "SeaBed", "Adabana Odd Tales", "Aokana", "Cyanotype Daydream",
    "Musicus!", "Nukitashi", "Meteor World Actor", "Hello Lady!", "Aiyoku no Eustia",
    "Baldr Sky", "Tokyo Necro", "Sorcery Jokers", "Dies irae", "Kajiri Kamui Kagura",
    "Kikokugai", "Saya no Uta", "Chaos;Child", "Steins;Gate 0", "Anonymous;Code",
    "MAMIYA", "Fatal Twelve", "The Shell Part I: Inferno", "Cartagra", "Kara no Shoujo 2",
    "Muv-Luv", "Totono", "YOU and ME and HER", "ATRI", "Harmonia",
    "Planetarian", "Loopers", "Marco & The Galaxy Dragon", "Slay the Princess", "Class of '09"
  ],

  books: [
    "House of Leaves", "Blood Meridian", "The Road", "Piranesi", "Never Let Me Go",
    "The Fifth Head of Cerberus", "Blindsight", "Book of the New Sun", "The Dispossessed", "Hyperion",
    "Annihilation", "Authority", "Acceptance", "Roadside Picnic", "Solaris",
    "No Longer Human", "The Trial", "Crime and Punishment", "The Master and Margarita", "Invisible Cities",
    "Infinite Jest", "White Noise", "2666", "If on a winter's night a traveler", "The Wind-Up Bird Chronicle",
    "Kafka on the Shore", "Hard-Boiled Wonderland and the End of the World", "Norwegian Wood", "The Sailor Who Fell from Grace with the Sea", "Convenience Store Woman",
    "A Canticle for Leibowitz", "Perdido Street Station", "The Scar", "Embassytown", "The Left Hand of Darkness",
    "The Sun Also Rises", "Stoner", "East of Eden", "Lonesome Dove", "The Brothers Karamazov",
    "The Spear Cuts Through Water", "This Is How You Lose the Time War", "The Saint of Bright Doors", "Bunny", "Lapvona",
    "Tender Is the Flesh", "Exquisite Corpse", "Earthlings", "Negative Space", "Geek Love"
  ],

  comics: [
    "The Invisibles", "Planetary", "Transmetropolitan", "100 Bullets", "Scalped",
    "The Nice House on the Lake", "Department of Truth", "Ice Cream Man", "The Nice House by the Sea", "Rare Flavours",
    "Hellblazer", "Lucifer", "Books of Magic", "Swamp Thing", "Animal Man",
    "Miracleman", "Black Hammer", "Once & Future", "Seven to Eternity", "LOW",
    "Descender", "Ascender", "Fear Agent", "Deadly Class", "Tokyo Ghost",
    "The Fade Out", "Criminal", "Kill or Be Killed", "Reckless", "Fatale",
    "East of West", "Lazarus", "Monstress", "The Wicked + The Divine", "Die",
    "Copra", "Prophet", "Extremity", "Murder Falcon", "Do A Powerbomb!",
    "Gideon Falls", "Black Monday Murders", "Nameless", "Providence", "From Hell",
    "ElfQuest", "Usagi Yojimbo", "Bone", "Aama", "Blacksad"
  ]
};

const RANDOM_STATUS = ['planned', 'in progress', 'completed', 'dropped'];
const ADD_DELAY_MS = 1200;

export const populateDemoData = async (store, setPopLog, setIsPopulating) => {
  setIsPopulating(true);
  setPopLog('Picking 5 random items per category...');

  const shuffleAndPick = (array) => {
    const shuffled = [...array].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5);
  };

  for (const [type, queries] of Object.entries(DEMO_QUERIES)) {
    const selected = shuffleAndPick(queries);
    for (const query of selected) {
      try {
        setPopLog(prev => prev + `\nSearching ${type}: "${query}"`);
        let result;
        switch (type) {
          case 'movies': result = await apiRegistry.searchMovies(query, 1); break;
          case 'tv': result = await apiRegistry.searchTV(query, 1); break;
          case 'games': result = await apiRegistry.searchGames(query, 1); break;
          case 'anime': result = await apiRegistry.searchAnime(query, 1); break;
          case 'manga': result = await apiRegistry.searchManga(query, 1); break;
          case 'comics': result = await apiRegistry.searchComics(query, 1); break;
          case 'vn': result = await apiRegistry.searchVNs(query, 1); break;
          case 'books': result = await apiRegistry.searchBooks(query, 1); break;
          default: continue;
        }

        if (result?.results?.length > 0) {
          const item = result.results[0];
          const status = RANDOM_STATUS[Math.floor(Math.random() * RANDOM_STATUS.length)];
          const rating = Math.random() > 0.3 ? Math.ceil(Math.random() * 10) : 0;

          let progress = 'Not Started';
          if (status === 'completed') {
            if (type === 'tv' || type === 'anime') progress = `${item.raw?.number_of_episodes || item.raw?.episodes || 1} Episodes`;
            else if (type === 'manga' || type === 'comics') progress = `${item.raw?.chapters || item.raw?.count_of_issues || item.raw?.issuesCount || 1} Chapters`;
          } else if (status === 'in progress') {
            if (type === 'tv') progress = `S01 E${Math.ceil(Math.random() * 5)}`;
            else if (type === 'anime') progress = `${Math.ceil(Math.random() * 6)} Episodes`;
            else if (type === 'manga' || type === 'comics') progress = `${Math.ceil(Math.random() * 30)} Chapters`;
            else if (type === 'games' || type === 'vn') progress = `${Math.ceil(Math.random() * 40)}%`;
          }

          const addedAt = Date.now() - Math.floor(Math.random() * 10000000000);
          const dateStarted = (status === 'in progress' || status === 'completed') ? addedAt + Math.floor(Math.random() * 86400000) : null;
          const dateCompleted = status === 'completed' ? dateStarted + Math.floor(Math.random() * 864000000) : null;

          store.addMediaItem({
            id: item.id,
            title: item.title,
            type,
            subtype: type,
            progress,
            status,
            rating,
            addedAt,
            dateStarted,
            dateCompleted,
            apiData: item
          }, type);

          if (status === 'completed' || status === 'in progress') {
            const logDate = status === 'completed' ? dateCompleted : dateStarted;
            store.addDiaryLog({
              log_id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2),
              media_id: String(item.id),
              media_type: type,
              action_type: status === 'completed' ? 'COMPLETED' : 'STARTED',
              log_date: new Date(logDate).toISOString(),
              review_text: rating >= 8 ? "Absolutely incredible. Highly recommended!" : rating > 0 && rating < 5 ? "Not my favorite, but glad I checked it out." : rating > 0 ? "It was pretty decent." : "",
              image: item.image || item.apiData?.image,
            });
          }

          setPopLog(prev => prev + ` -> Added: ${item.title}`);
        }

        await new Promise(resolve => setTimeout(resolve, ADD_DELAY_MS));
      } catch (err) {
        setPopLog(prev => prev + ` -> Failed: ${err.message}`);
      }
    }
  }

  setPopLog(prev => prev + '\nFinished! 40 items added (5 per type).');
  setIsPopulating(false);
};

const Settings = () => {
  const [isClearing, setIsClearing] = useState(false);
  const [isNuking, setIsNuking] = useState(false);
  const store = useMediaStore();

  const handleClearStorage = () => {
    if (window.confirm('Delete ALL local data? This cannot be undone.')) {
      setIsClearing(true);
      const req = indexedDB.deleteDatabase('polyhedron-db');
      req.onsuccess = () => window.location.reload();
      req.onerror = () => window.location.reload();
      setTimeout(() => window.location.reload(), 1500); // Safety fallback
    }
  };

  const handlePopulateData = async () => {
    setIsPopulating(true);
    setPopLog('Picking 5 random items per category...');

    for (const [type, queries] of Object.entries(DEMO_QUERIES)) {
      const selected = shuffleAndPick(queries);
      for (const query of selected) {
        try {
          setPopLog(prev => prev + `\nSearching ${type}: "${query}"`);
          let result;
          switch (type) {
            case 'movies': result = await apiRegistry.searchMovies(query, 1); break;
            case 'tv': result = await apiRegistry.searchTV(query, 1); break;
            case 'games': result = await apiRegistry.searchGames(query, 1); break;
            case 'anime': result = await apiRegistry.searchAnime(query, 1); break;
            case 'manga': result = await apiRegistry.searchManga(query, 1); break;
            case 'comics': result = await apiRegistry.searchComics(query, 1); break;
            case 'vn': result = await apiRegistry.searchVNs(query, 1); break;
            case 'books': result = await apiRegistry.searchBooks(query, 1); break;
            default: continue;
          }

          if (result?.results?.length > 0) {
            const item = result.results[0];
            const status = RANDOM_STATUS[Math.floor(Math.random() * RANDOM_STATUS.length)];
            const rating = Math.random() > 0.3 ? Math.ceil(Math.random() * 10) : 0;

            let progress = 'Not Started';
            if (status === 'completed') {
              if (type === 'tv' || type === 'anime') progress = `${item.raw?.number_of_episodes || item.raw?.episodes || 1} Episodes`;
              else if (type === 'manga' || type === 'comics') progress = `${item.raw?.chapters || item.raw?.count_of_issues || item.raw?.issuesCount || 1} Chapters`;
            } else if (status === 'in progress') {
              if (type === 'tv') progress = `S01 E${Math.ceil(Math.random() * 5)}`;
              else if (type === 'anime') progress = `${Math.ceil(Math.random() * 6)} Episodes`;
              else if (type === 'manga' || type === 'comics') progress = `${Math.ceil(Math.random() * 30)} Chapters`;
              else if (type === 'games' || type === 'vn') progress = `${Math.ceil(Math.random() * 40)}%`;
            }

            store.addMediaItem({
              id: item.id,
              title: item.title,
              type,
              subtype: type,
              progress,
              status,
              rating,
              addedAt: Date.now() - Math.floor(Math.random() * 1000000000),
              dateStarted: status === 'in progress' || status === 'completed' ? Date.now() - 86400000 : null,
              dateCompleted: status === 'completed' ? Date.now() : null,
              apiData: item
            }, type);

            setPopLog(prev => prev + ` -> Added: ${item.title}`);
          }

          await new Promise(resolve => setTimeout(resolve, ADD_DELAY_MS));
        } catch (err) {
          setPopLog(prev => prev + ` -> Failed: ${err.message}`);
        }
      }
    }

    setPopLog(prev => prev + '\nFinished! 40 items added (5 per type).');
    setIsPopulating(false);
  };

  const handleNukeCloudData = async () => {
    if (window.confirm('WARNING: This will permanently delete your entire library and all diary logs from the cloud. Are you sure?')) {
      if (window.confirm('FINAL WARNING: This action cannot be undone!')) {
        setIsNuking(true);
        try {
          await store.nukeCloudData();
          alert('Your databank has been completely wiped.');
        } finally {
          setIsNuking(false);
        }
      }
    }
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6 animate-in fade-in duration-300">
      <h1 className="text-2xl font-black uppercase tracking-widest font-sans border-b border-base-300 pb-2">Settings</h1>

      <div className="bg-base-100 border border-base-300 p-6 flex flex-col gap-4">
        <h2 className="text-sm font-black uppercase tracking-widest text-error">Danger Zone</h2>
        <p className="text-xs font-mono text-base-content/70">Remove all stored library data and reset the app to its initial state.</p>
        <button
          onClick={handleClearStorage}
          disabled={isClearing}
          className="flex items-center justify-center h-10 px-4 bg-transparent border border-error text-error hover:bg-error hover:text-error-content rounded-none appearance-none font-mono text-xs uppercase tracking-widest gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-fit"
        >
          {isClearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          Clear All Local Data
        </button>

        {store.authMode === 'admin' && (
          <>
            <div className="divider my-1 opacity-20"></div>
            <h2 className="text-sm font-black uppercase tracking-widest text-error flex items-center gap-2 mt-2"><AlertTriangle className="w-4 h-4" /> Cloud Databank</h2>
            <p className="text-xs font-mono text-base-content/70">Completely wipe your Supabase cloud database. This will delete all saved media and logs globally.</p>
            <button
              onClick={handleNukeCloudData}
              disabled={isClearing || isNuking}
              className="flex items-center justify-center h-10 px-4 bg-error hover:bg-error/90 text-error-content rounded-none appearance-none font-mono text-xs uppercase tracking-widest gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-error/20 w-fit"
            >
              {isNuking ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
              Nuke Cloud Databank
            </button>
          </>
        )}
      </div>

    </div>
  );
};

export default Settings;