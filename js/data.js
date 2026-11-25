/*
 * Itinerary data for the Muni Challenge.
 *
 * Each block is a time window (with a map color); each leg is one ride on one line.
 *   line     – display name of the line (unique per line; used for counting)
 *   mode     – "cable" | "rail" | "bus" | "owl"
 *   board / alight / next – where to get on, off, and how to reach the next leg
 *   from / to – [lat, lng] of the board and alight points, for the map
 *   note     – optional free text
 *   risk     – true for low-frequency legs that need slack in the schedule
 *   option   – leg only appears when that option is on ("owl", "event", "earlybird")
 *
 * Cross-streets and coordinates are approximations — verify against sfmta.com/routes.
 */
window.MUNI_DATA = {
  finish: { name: "Bus Stop (bar), 1901 Union St", at: [37.7979, -122.4310] },

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
      color: "#5b3a8a",
      option: "owl",
      legs: [
        { line: "90 San Bruno Owl", mode: "owl", board: "1st & Mission", alight: "San Bruno Ave & Silver", next: "Head back downtown to 3rd & Market", note: "Overnight substitute for the 9 corridor.", from: [37.7898, -122.3970], to: [37.7290, -122.4038] },
        { line: "91 3rd St/19th Ave Owl", mode: "owl", board: "3rd & Market", alight: "19th Ave & Holloway", next: "Head to West Portal Station", note: "Covers the T and 28 corridors overnight — the longest Owl run.", from: [37.7873, -122.4034], to: [37.7215, -122.4752] },
        { line: "L Owl", mode: "owl", board: "West Portal Station", alight: "Taraval & Sunset Blvd", next: "Head to Duboce & Church", note: "Overnight substitute for the L corridor.", from: [37.7409, -122.4660], to: [37.7421, -122.4941] },
        { line: "N Owl", mode: "owl", board: "Duboce & Church", alight: "Judah & La Playa (beach)", next: "Head back downtown for the 5:45 AM cable cars", note: "Overnight substitute for the N corridor.", from: [37.7695, -122.4290], to: [37.7604, -122.5091] },
        { line: "714 BART Early Bird", mode: "owl", option: "earlybird", board: "Near Salesforce Transit Center (~4:45 AM)", alight: "Balboa Park Station", next: "Back downtown to start the cable cars", note: "One bus, one direction, one trip — pure completism.", from: [37.7895, -122.3967], to: [37.7215, -122.4475] },
      ],
    },
    {
      id: "cable",
      time: "5:45–6:50 AM",
      title: "Downtown cable car trio (before the queues form)",
      color: "#7b3f00",
      legs: [
        { line: "Powell–Hyde Cable Car", mode: "cable", board: "Powell & Market turntable", alight: "Hyde & Beach (Aquatic Park)", next: "Walk 3 blocks to Bay & Taylor", note: "Ride the full line to clear 3 blocks past the Mason split.", from: [37.7849, -122.4078], to: [37.8065, -122.4209] },
        { line: "Powell–Mason Cable Car", mode: "cable", board: "Bay & Taylor", alight: "Washington & Mason", next: "Walk 2 blocks to California & Powell", note: "Distinct trackage from the Hyde line.", from: [37.8048, -122.4155], to: [37.7947, -122.4105] },
        { line: "California Cable Car", mode: "cable", board: "California & Powell", alight: "Van Ness & California", next: "Same corner — catch the 49", note: "Drops you right on the Van Ness corridor.", from: [37.7920, -122.4091], to: [37.7905, -122.4223] },
      ],
    },
    {
      id: "west-addition",
      time: "6:50–8:45 AM",
      title: "Van Ness, Polk, Pacific Heights, Western Addition",
      color: "#2166ac",
      legs: [
        { line: "49 Van Ness/Mission", mode: "bus", board: "Van Ness & California", alight: "Van Ness & Sutter", next: "Walk 1 block to Polk & Sutter", note: "Short southbound hop.", from: [37.7905, -122.4223], to: [37.7876, -122.4218] },
        { line: "19 Polk", mode: "bus", board: "Polk & Sutter", alight: "Polk & Sacramento", next: "Same corner — catch the 1 westbound", note: "Ride north on Polk.", from: [37.7880, -122.4202], to: [37.7913, -122.4208] },
        { line: "1 California", mode: "bus", board: "Sacramento & Polk", alight: "Sacramento & Fillmore", next: "Walk 4 blocks south to Sutter & Fillmore", note: "Covers the 1X variant.", from: [37.7913, -122.4208], to: [37.7896, -122.4339] },
        { line: "2 Sutter", mode: "bus", board: "Sutter & Fillmore", alight: "Sutter & Divisadero", next: "Same corner — catch the 24 southbound", from: [37.7860, -122.4331], to: [37.7850, -122.4396] },
        { line: "24 Divisadero", mode: "bus", board: "Divisadero & Sutter", alight: "Divisadero & Haight", next: "Walk 4 blocks east to Fillmore & Haight", from: [37.7850, -122.4396], to: [37.7712, -122.4373] },
        { line: "22 Fillmore", mode: "bus", board: "Fillmore & Haight", alight: "Fillmore & Geary", next: "Same corner — catch the 38 westbound", note: "North–south spine of the Western Addition.", from: [37.7720, -122.4307], to: [37.7841, -122.4329] },
        { line: "38 Geary", mode: "bus", board: "Geary & Fillmore", alight: "Geary & Masonic", next: "Same corner", note: "Covers the 38R. No need to ride to the beach.", from: [37.7841, -122.4329], to: [37.7826, -122.4464] },
        { line: "43 Masonic", mode: "bus", board: "Masonic & Geary", alight: "Masonic & Fulton", next: "Same corner", from: [37.7826, -122.4464], to: [37.7765, -122.4455] },
        { line: "5 Fulton", mode: "bus", board: "Fulton & Masonic", alight: "Fulton & Stanyan", next: "Walk 3 blocks to Haight & Stanyan", note: "Covers the 5R. Edge of Golden Gate Park.", from: [37.7765, -122.4455], to: [37.7752, -122.4540] },
      ],
    },
    {
      id: "sunset",
      time: "8:45–11:15 AM",
      title: "Haight, Sunset and the west-side rail spokes",
      color: "#1a9850",
      legs: [
        { line: "7 Haight/Noriega", mode: "bus", board: "Haight & Stanyan", alight: "Cole & Carl", next: "Walk to the Carl & Cole N Judah stop", note: "Short segment before the N takes over the corridor.", from: [37.7692, -122.4535], to: [37.7657, -122.4500] },
        { line: "N Judah", mode: "rail", board: "Carl & Cole", alight: "Judah & 19th Ave", next: "Same corner — catch the 66", note: "Ride to Ocean Beach and back if you have time to spare.", from: [37.7657, -122.4500], to: [37.7617, -122.4770] },
        { line: "66 Quintara", mode: "bus", board: "19th Ave & Judah", alight: "19th Ave & Quintara", next: "Walk 3 blocks to Taraval & 19th Ave", from: [37.7617, -122.4770], to: [37.7484, -122.4757] },
        { line: "L Taraval", mode: "rail", board: "Taraval & 19th Ave", alight: "Taraval & Sunset Blvd", next: "Walk 4 blocks to Sunset Blvd & Ortega", from: [37.7430, -122.4753], to: [37.7421, -122.4941] },
        { line: "48 Quintara/24th St", mode: "bus", board: "Sunset Blvd & Ortega", alight: "Sunset Blvd & Vicente", next: "Walk to Vicente & 19th Ave", from: [37.7521, -122.4948], to: [37.7394, -122.4937] },
        { line: "29 Sunset", mode: "bus", board: "19th Ave & Vicente", alight: "19th Ave & Randolph", next: "Walk 4 blocks to Ocean Ave & Junipero Serra", note: "Long crosstown line — a short piece is enough.", from: [37.7394, -122.4751], to: [37.7143, -122.4726] },
        { line: "K Ingleside", mode: "rail", board: "Junipero Serra & Ocean", alight: "Ocean Ave & Phelan (City College)", next: "Head to Broad & Plymouth for the M", from: [37.7313, -122.4716], to: [37.7240, -122.4523] },
        { line: "M Ocean View", mode: "rail", board: "Broad & Plymouth", alight: "Broad & Orizaba", next: "Head to 19th Ave & Holloway", from: [37.7132, -122.4560], to: [37.7130, -122.4628] },
        { line: "57 Parkmerced", mode: "bus", board: "19th Ave & Holloway (Parkmerced loop)", alight: "Full loop back", next: "Walk 4 blocks toward Lake Merced Blvd", note: "Short shuttle loop through Parkmerced.", from: [37.7215, -122.4752], to: [37.7190, -122.4810] },
        { line: "58 Lake Merced", mode: "bus", board: "Lake Merced Blvd & Higuera", alight: "Lake Merced Blvd & Sloat", next: "Walk 4 blocks to Sloat & 19th Ave", risk: true, note: "~20–30 min headways — check predictions before committing.", from: [37.7180, -122.4860], to: [37.7344, -122.4950] },
        { line: "18 46th Ave", mode: "bus", board: "Sloat & 19th Ave", alight: "Sloat & 34th Ave", next: "Head east toward Diamond Heights", note: "Runs along the Zoo/ocean edge.", from: [37.7343, -122.4752], to: [37.7347, -122.4913] },
      ],
    },
    {
      id: "twin-peaks",
      time: "11:15 AM–1:30 PM",
      title: "Twin Peaks, Diamond Heights, Noe, Castro",
      color: "#8e44ad",
      legs: [
        { line: "36 Teresita", mode: "bus", board: "Diamond Heights & Duncan", alight: "Teresita Blvd & Foerster", next: "Head back toward Diamond Heights Blvd", risk: true, note: "~20+ min headways — good place for slack.", from: [37.7450, -122.4390], to: [37.7340, -122.4485] },
        { line: "37 Corbett", mode: "bus", board: "Diamond Heights loop", alight: "Corbett & Levant", next: "Head down to Church & Market", risk: true, note: "Steep, slow, ~20-min headways — one of the tightest links of the day.", from: [37.7432, -122.4398], to: [37.7618, -122.4456] },
        { line: "35 Eureka", mode: "bus", board: "Church & Market", alight: "Clipper & Diamond", next: "Walk to Church & 30th for the J", from: [37.7675, -122.4290], to: [37.7495, -122.4365] },
        { line: "J Church", mode: "rail", board: "Church & 30th", alight: "Church & 18th", next: "Walk 2 blocks to 18th & Castro", from: [37.7420, -122.4267], to: [37.7614, -122.4282] },
        { line: "33 Ashbury/18th St", mode: "bus", board: "18th & Castro", alight: "18th & Mission", next: "Walk south to Mission & 24th", from: [37.7609, -122.4350], to: [37.7616, -122.4192] },
      ],
    },
    {
      id: "mission",
      time: "1:30–4:00 PM",
      title: "Mission, Bernal, Excelsior, Outer Mission",
      color: "#d7301f",
      legs: [
        { line: "14 Mission", mode: "bus", board: "Mission & 24th", alight: "Mission & Cortland", next: "Walk 4 blocks to Cortland & Andover", note: "Covers the 14R.", from: [37.7524, -122.4183], to: [37.7388, -122.4232] },
        { line: "67 Bernal Heights", mode: "bus", board: "Cortland & Andover", alight: "Cortland & Folsom", next: "Walk 4 blocks to Mission & Randall", risk: true, note: "Low frequency, hilly loop — build in slack.", from: [37.7391, -122.4160], to: [37.7396, -122.4137] },
        { line: "23 Monterey", mode: "bus", board: "Mission & Randall", alight: "Monterey Blvd & Detroit", next: "Head to Ocean Ave & Phelan", from: [37.7397, -122.4235], to: [37.7316, -122.4378] },
        { line: "52 Excelsior", mode: "bus", board: "Ocean Ave & Phelan", alight: "Ocean Ave & Delano", next: "Walk 4 blocks to Mission & Geneva", from: [37.7240, -122.4523], to: [37.7232, -122.4410] },
        { line: "54 Felton", mode: "bus", board: "Mission & Geneva", alight: "Felton & Bowdoin", next: "Head to San Bruno Ave & Silver", from: [37.7166, -122.4407], to: [37.7270, -122.4108] },
        { line: "9 San Bruno", mode: "bus", board: "San Bruno & Silver", alight: "San Bruno & Paul", next: "Walk 1 block to Bayshore & Paul", note: "Covers the 9R.", from: [37.7290, -122.4038], to: [37.7232, -122.4020] },
        { line: "8 Bayshore", mode: "bus", board: "Bayshore & Paul", alight: "Bayshore & Sunnydale", next: "Head to Visitacion & Rutland", note: "Covers the 8AX/8BX.", from: [37.7234, -122.4006], to: [37.7088, -122.4050] },
      ],
    },
    {
      id: "bayview",
      time: "4:00–6:15 PM",
      title: "Visitacion Valley, Bayview, Dogpatch, SoMa, North Beach",
      color: "#e6791a",
      legs: [
        { line: "56 Rutland", mode: "bus", board: "Visitacion & Rutland", alight: "Rutland & Wayland", next: "Head to 3rd St & Gilman", risk: true, note: "One of the least frequent lines in the system — plan slack.", from: [37.7130, -122.4070], to: [37.7205, -122.4075] },
        { line: "T Third Street", mode: "rail", board: "3rd St & Gilman", alight: "3rd St & Williams", next: "Same corner — catch the 15", from: [37.7180, -122.3920], to: [37.7290, -122.3925] },
        { line: "15 Bayview Hunters Point Express", mode: "bus", board: "3rd St & Williams", alight: "3rd St & Evans", next: "Head to 3rd & 22nd", note: "Peak-oriented — verify the current schedule.", from: [37.7290, -122.3925], to: [37.7425, -122.3876] },
        { line: "55 Dogpatch", mode: "bus", board: "3rd & 22nd St", alight: "3rd & 16th St", next: "Event day: catch the 78X. Otherwise head to Silver & Girard for the 44.", from: [37.7578, -122.3884], to: [37.7666, -122.3893] },
        { line: "78X 16th St Arena Express", mode: "bus", option: "event", board: "16th St & 3rd", alight: "Chase Center", next: "Head to Silver & Girard", note: "Event days only; timing depends on the event.", from: [37.7666, -122.3893], to: [37.7680, -122.3877] },
        { line: "44 O'Shaughnessy", mode: "bus", board: "Silver & Girard", alight: "O'Shaughnessy & Del Vale", next: "Head to Folsom & 24th", note: "Long crosstown; a short segment suffices.", from: [37.7300, -122.4060], to: [37.7395, -122.4430] },
        { line: "12 Folsom/Pacific", mode: "bus", board: "Folsom & 24th", alight: "Folsom & 9th", next: "Walk 3 blocks to Bryant & 9th", from: [37.7525, -122.4140], to: [37.7740, -122.4130] },
        { line: "27 Bryant", mode: "bus", board: "Bryant & 9th", alight: "Bryant & 4th", next: "Walk 4 blocks to 4th & Market", from: [37.7710, -122.4078], to: [37.7790, -122.3973] },
        { line: "30 Stockton", mode: "bus", board: "4th & Market", alight: "Stockton & Washington", next: "Walk to Washington Square", note: "Covers the 30X.", from: [37.7856, -122.4057], to: [37.7952, -122.4073] },
        { line: "39 Coit", mode: "bus", board: "Washington Square", alight: "Coit Tower loop", next: "Head down to Jones & Beach", from: [37.8008, -122.4100], to: [37.8024, -122.4058] },
        { line: "F Market & Wharves", mode: "rail", board: "Jones & Beach (Fisherman's Wharf)", alight: "Embarcadero & Mission", next: "Walk to Salesforce Transit Center", note: "Historic streetcar along the Embarcadero.", from: [37.8073, -122.4174], to: [37.7935, -122.3930] },
        { line: "25 Treasure Island", mode: "bus", board: "Salesforce Transit Center", alight: "Treasure Island and back", next: "Return to the Transit Center", note: "Bay Bridge round trip — budget 45–60 min.", from: [37.7895, -122.3967], to: [37.8235, -122.3706] },
      ],
    },
    {
      id: "finish",
      time: "6:15–8:45 PM",
      title: "Inner Sunset, Richmond, Marina — to the finish",
      color: "#d6249f",
      legs: [
        { line: "6 Hayes/Parnassus", mode: "bus", board: "Parnassus & 3rd Ave (UCSF)", alight: "Hayes & Masonic", next: "Head to Balboa & Arguello", note: "Flexible — slot it in earlier if it fits better.", from: [37.7633, -122.4605], to: [37.7735, -122.4458] },
        { line: "31 Balboa", mode: "bus", board: "Balboa & Arguello", alight: "Balboa & Park Presidio", next: "Walk 4 blocks to Geary & Park Presidio", from: [37.7768, -122.4589], to: [37.7759, -122.4719] },
        { line: "28 19th Avenue", mode: "bus", board: "Geary & Park Presidio", alight: "Lombard & Fillmore (Marina)", next: "Walk 3 blocks to Union & Steiner", note: "Covers the 28R.", from: [37.7804, -122.4723], to: [37.7998, -122.4354] },
        { line: "45 Union/Stockton", mode: "bus", board: "Union & Steiner", alight: "Union & Laguna", next: "You're at the finish — Bus Stop is on this corner", note: "Final line of the day.", from: [37.7975, -122.4378], to: [37.7979, -122.4310] },
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
    "Board/alight cross-streets and map points are close approximations, and map lines are straight-line connections, not exact street alignments. Double-check against sfmta.com/routes where Muni Forward has moved stops.",
  ],
};
