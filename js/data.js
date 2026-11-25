/*
 * Itinerary data for the Muni Challenge.
 *
 * Each block is a time window; each leg is one ride on one line.
 *   line     – display name of the line (unique per line; used for counting)
 *   mode     – "cable" | "rail" | "bus" | "owl"
 *   board / alight / next – where to get on, off, and how to reach the next leg
 *   note     – optional free text
 *   risk     – true for low-frequency legs that need slack in the schedule
 *   option   – leg only appears when that option is on ("owl", "event", "earlybird")
 *
 * Board/alight cross-streets are approximations — verify against sfmta.com/routes.
 */
window.MUNI_DATA = {
  options: {
    owl: {
      label: "Include Owl lines",
      hint: "Adds the four overnight-only routes (≈12:30–5 AM), run before the cable cars. Turns the day into a ~20-hour outing.",
    },
    event: {
      label: "Chase Center event day",
      hint: "The 78X 16th St Arena Express only runs around Chase Center events.",
    },
    earlybird: {
      label: "Completist: 714 BART Early Bird",
      hint: "A single pre-dawn trip to Balboa Park BART. Only makes sense with Owl lines on.",
      requires: "owl",
    },
  },

  blocks: [
    {
      id: "owl",
      time: "12:30–5:00 AM",
      title: "Owl lines (overnight, while the subway is closed)",
      option: "owl",
      legs: [
        { line: "90 San Bruno Owl", mode: "owl", board: "1st & Mission", alight: "San Bruno Ave & Silver", next: "Walk 4 blocks toward Bayshore", note: "Overnight substitute for the 9 corridor." },
        { line: "91 3rd St/19th Ave Owl", mode: "owl", board: "3rd & Market", alight: "19th Ave & Holloway", next: "Walk toward 19th & Winston", note: "Covers the T and 28 corridors overnight — the longest Owl run." },
        { line: "L Owl", mode: "owl", board: "West Portal Station", alight: "SF State / 19th Ave & Holloway", next: "Walk toward Junipero Serra", note: "Overnight substitute for the L/K corridor." },
        { line: "N Owl", mode: "owl", board: "Duboce & Church", alight: "Judah & La Playa (beach)", next: "Head back downtown for the 5:45 AM cable cars", note: "Overnight substitute for the N/J corridor." },
        { line: "714 BART Early Bird", mode: "owl", option: "earlybird", board: "Near Salesforce Transit Center (~4:45 AM)", alight: "Balboa Park Station", next: "Back downtown to start the cable cars", note: "One bus, one direction, one trip — pure completism." },
      ],
    },
    {
      id: "cable",
      time: "5:45–6:50 AM",
      title: "Downtown cable car trio (before the queues form)",
      legs: [
        { line: "Powell–Hyde Cable Car", mode: "cable", board: "Powell & Market turntable", alight: "Hyde & Beach (Aquatic Park)", next: "Walk 3 blocks to Bay & Taylor", note: "Ride the full line to clear 3 blocks past the Mason split." },
        { line: "Powell–Mason Cable Car", mode: "cable", board: "Bay & Taylor", alight: "Washington & Mason", next: "Walk 2 blocks to California & Powell", note: "Distinct trackage from the Hyde line." },
        { line: "California Cable Car", mode: "cable", board: "California & Powell", alight: "Van Ness & California", next: "Same corner — catch the 49", note: "Drops you right on the Van Ness corridor." },
      ],
    },
    {
      id: "west-addition",
      time: "6:50–8:45 AM",
      title: "Van Ness, Polk, Pacific Heights, Western Addition",
      legs: [
        { line: "49 Van Ness/Mission", mode: "bus", board: "Van Ness & California", alight: "Van Ness & Sutter", next: "Walk 1 block to Polk & Sutter", note: "Short southbound hop." },
        { line: "19 Polk", mode: "bus", board: "Polk & Sutter", alight: "Polk & Sacramento", next: "Same corner — catch the 1 westbound", note: "Ride north on Polk." },
        { line: "1 California", mode: "bus", board: "Sacramento & Polk", alight: "Sacramento & Fillmore", next: "Walk 4 blocks south to Sutter & Fillmore", note: "Covers the 1X variant." },
        { line: "2 Sutter", mode: "bus", board: "Sutter & Fillmore", alight: "Sutter & Divisadero", next: "Same corner — catch the 24 southbound" },
        { line: "24 Divisadero", mode: "bus", board: "Divisadero & Sutter", alight: "Divisadero & Haight", next: "Walk 4 blocks east to Fillmore & Haight" },
        { line: "22 Fillmore", mode: "bus", board: "Fillmore & Haight", alight: "Fillmore & Geary", next: "Same corner — catch the 38 westbound", note: "North–south spine of the Western Addition." },
        { line: "38 Geary", mode: "bus", board: "Geary & Fillmore", alight: "Geary & Masonic", next: "Same corner", note: "Covers the 38R. No need to ride to the beach." },
        { line: "43 Masonic", mode: "bus", board: "Masonic & Geary", alight: "Masonic & Fulton", next: "Same corner" },
        { line: "5 Fulton", mode: "bus", board: "Fulton & Masonic", alight: "Fulton & Stanyan", next: "Walk 3 blocks to Haight & Stanyan", note: "Covers the 5R. Edge of Golden Gate Park." },
      ],
    },
    {
      id: "sunset",
      time: "8:45–11:15 AM",
      title: "Haight, Sunset and the west-side rail spokes",
      legs: [
        { line: "7 Haight/Noriega", mode: "bus", board: "Haight & Stanyan", alight: "Cole & Carl", next: "Walk to the Carl & Cole N Judah stop", note: "Short segment before the N takes over the corridor." },
        { line: "N Judah", mode: "rail", board: "Carl & Cole", alight: "Judah & 19th Ave", next: "Same corner — catch the 66", note: "Ride to Ocean Beach and back if you have time to spare." },
        { line: "66 Quintara", mode: "bus", board: "19th Ave & Judah", alight: "19th Ave & Quintara", next: "Walk 3 blocks to Taraval & 19th Ave" },
        { line: "L Taraval", mode: "rail", board: "Taraval & 19th Ave", alight: "Taraval & Sunset Blvd", next: "Walk 4 blocks to Sunset Blvd & Ortega" },
        { line: "48 Quintara/24th St", mode: "bus", board: "Sunset Blvd & Ortega", alight: "Sunset Blvd & Vicente", next: "Walk to Vicente & 19th Ave" },
        { line: "29 Sunset", mode: "bus", board: "19th Ave & Vicente", alight: "19th Ave & Randolph", next: "Walk 4 blocks to Ocean Ave & Junipero Serra", note: "Long crosstown line — a short piece is enough." },
        { line: "K Ingleside", mode: "rail", board: "Junipero Serra & Ocean", alight: "Ocean Ave & Phelan (City College)", next: "Head to Broad & Plymouth for the M" },
        { line: "M Ocean View", mode: "rail", board: "Broad & Plymouth", alight: "Broad & Orizaba", next: "Walk 4 blocks to Orizaba & Randolph" },
        { line: "57 Parkmerced", mode: "bus", board: "19th Ave & Holloway (Parkmerced loop)", alight: "Full loop back", next: "Walk 4 blocks toward Lake Merced Blvd", note: "Short shuttle loop through Parkmerced." },
        { line: "58 Lake Merced", mode: "bus", board: "Lake Merced Blvd & Higuera", alight: "Lake Merced Blvd & Sloat", next: "Walk 4 blocks to Sloat & 19th Ave", risk: true, note: "~20–30 min headways — check predictions before committing." },
        { line: "18 46th Ave", mode: "bus", board: "Sloat & 19th Ave", alight: "Sloat & 34th Ave", next: "Head east toward Diamond Heights", note: "Runs along the Zoo/ocean edge." },
      ],
    },
    {
      id: "twin-peaks",
      time: "11:15 AM–1:30 PM",
      title: "Twin Peaks, Diamond Heights, Noe, Castro",
      legs: [
        { line: "36 Teresita", mode: "bus", board: "Diamond Heights & Duncan", alight: "Teresita Blvd & Foerster", next: "Walk 4 blocks toward Diamond Heights Blvd", risk: true, note: "~20+ min headways — good place for slack." },
        { line: "37 Corbett", mode: "bus", board: "Diamond Heights loop", alight: "Corbett & Levant", next: "Head down to Church & Market", risk: true, note: "Steep, slow, ~20-min headways — one of the tightest links of the day." },
        { line: "35 Eureka", mode: "bus", board: "Church & Market", alight: "Clipper & Diamond", next: "Walk to Church & 30th for the J" },
        { line: "J Church", mode: "rail", board: "Church & 30th", alight: "Church & 18th", next: "Walk 2 blocks to 18th & Castro" },
        { line: "33 Ashbury/18th St", mode: "bus", board: "18th & Castro", alight: "18th & Mission", next: "Walk south to Mission & 24th" },
      ],
    },
    {
      id: "mission",
      time: "1:30–4:00 PM",
      title: "Mission, Bernal, Excelsior, Outer Mission",
      legs: [
        { line: "14 Mission", mode: "bus", board: "Mission & 24th", alight: "Mission & Cortland", next: "Walk 4 blocks to Cortland & Andover", note: "Covers the 14R." },
        { line: "67 Bernal Heights", mode: "bus", board: "Cortland & Andover", alight: "Cortland & Folsom", next: "Walk 4 blocks to Mission & Cortland", risk: true, note: "Low frequency, hilly loop — build in slack." },
        { line: "23 Monterey", mode: "bus", board: "Mission & Randall", alight: "Monterey Blvd & Detroit", next: "Head to Ocean Ave & Phelan" },
        { line: "52 Excelsior", mode: "bus", board: "Ocean Ave & Phelan", alight: "Ocean Ave & Delano", next: "Walk 4 blocks to Mission & Geneva" },
        { line: "54 Felton", mode: "bus", board: "Mission & Geneva", alight: "Felton & Bowdoin", next: "Walk 3 blocks to San Bruno Ave & Silver" },
        { line: "9 San Bruno", mode: "bus", board: "San Bruno & Silver", alight: "San Bruno & Paul", next: "Walk 4 blocks to Bayshore & Paul", note: "Covers the 9R." },
        { line: "8 Bayshore", mode: "bus", board: "Bayshore & Paul", alight: "Bayshore & Sunnydale", next: "Head to Bayshore & Rutland", note: "Covers the 8AX/8BX." },
      ],
    },
    {
      id: "bayview",
      time: "4:00–6:15 PM",
      title: "Visitacion Valley, Bayview, Dogpatch, SoMa, North Beach",
      legs: [
        { line: "56 Rutland", mode: "bus", board: "Bayshore & Rutland", alight: "Rutland & Wayland", next: "Head to 3rd St & Gilman", risk: true, note: "One of the least frequent lines in the system — plan slack." },
        { line: "T Third Street", mode: "rail", board: "3rd St & Gilman", alight: "3rd St & Williams", next: "Same corner — catch the 15", note: "" },
        { line: "15 Bayview Hunters Point Express", mode: "bus", board: "3rd St & Williams", alight: "3rd St & Evans", next: "Head to 3rd & 22nd", note: "Peak-oriented — verify the current schedule." },
        { line: "55 Dogpatch", mode: "bus", board: "3rd & 22nd St", alight: "3rd & 16th St", next: "Event day: catch the 78X. Otherwise head to Bayview & Third for the 44." },
        { line: "78X 16th St Arena Express", mode: "bus", option: "event", board: "16th St & 3rd", alight: "Chase Center", next: "Head back toward Bayview & Third", note: "Event days only; timing depends on the event." },
        { line: "44 O'Shaughnessy", mode: "bus", board: "Silver & Girard", alight: "O'Shaughnessy & Del Vale", next: "Head to Folsom & 24th", note: "Long crosstown; a short segment suffices." },
        { line: "12 Folsom/Pacific", mode: "bus", board: "Folsom & 24th", alight: "Folsom & 9th", next: "Walk 3 blocks to Bryant & 9th" },
        { line: "27 Bryant", mode: "bus", board: "Bryant & 9th", alight: "Bryant & 4th", next: "Walk 4 blocks to 4th & Market" },
        { line: "30 Stockton", mode: "bus", board: "4th & Market", alight: "Stockton & Washington", next: "Walk to Washington Square", note: "Covers the 30X." },
        { line: "39 Coit", mode: "bus", board: "Washington Square", alight: "Coit Tower loop", next: "Head down to Jones & Beach" },
        { line: "F Market & Wharves", mode: "rail", board: "Jones & Beach (Fisherman's Wharf)", alight: "Embarcadero & Mission", next: "Walk to Salesforce Transit Center", note: "Historic streetcar along the Embarcadero." },
        { line: "25 Treasure Island", mode: "bus", board: "Salesforce Transit Center", alight: "Treasure Island and back", next: "Return to the Transit Center", note: "Bay Bridge round trip — budget 45–60 min." },
      ],
    },
    {
      id: "finish",
      time: "6:15–8:45 PM",
      title: "Inner Sunset, Richmond, Marina — to the finish",
      legs: [
        { line: "6 Hayes/Parnassus", mode: "bus", board: "Parnassus & 3rd Ave (UCSF)", alight: "Hayes & Masonic", next: "Walk to Balboa & Masonic", note: "Flexible — slot it in earlier if it fits better." },
        { line: "31 Balboa", mode: "bus", board: "Balboa & Masonic", alight: "Balboa & Park Presidio", next: "Head to Geary & 19th Ave" },
        { line: "28 19th Avenue", mode: "bus", board: "Geary & 19th Ave", alight: "Chestnut & Fillmore (Marina)", next: "Same corner — catch the 45", note: "Covers the 28R." },
        { line: "45 Union/Stockton", mode: "bus", board: "Chestnut & Fillmore", alight: "Union & Steiner", next: "Walk 2 blocks to the Bus Stop bar, Union St", note: "Final line of the day." },
      ],
    },
  ],

  excluded: [
    "S Shuttle and the K/L/M/N/T “Bus” substitutes — rail-replacement duplicates, not standalone routes.",
    "BART, Caltrain, Golden Gate Transit, AC Transit, ferries — this is Muni-only.",
  ],

  caveats: [
    "This is a geography-and-frequency plan, not a live timetable. On the day, use real-time predictions (sfmta.com or 511.org) and adjust as you go.",
    "The real risk is the low-frequency lines flagged ⚠: 58, 36, 37, 67 and 56 run every 20–30+ minutes. Build buffer around those, not the frequent trunk lines (14, 38, 30, 49, N…).",
    "Board/alight cross-streets are close approximations. Double-check against sfmta.com/routes where Muni Forward has moved stops.",
  ],
};
