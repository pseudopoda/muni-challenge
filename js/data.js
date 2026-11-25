/*
 * Line list and notes for the Muni Challenge.
 *
 * The actual itinerary (order, stops, times, map paths) is generated from SFMTA's
 * GTFS feed by scripts/plan.py into js/plan.js. This file says WHICH lines to ride
 * and what to know about each one:
 *   line   – display name (the first word, or ROUTE_OF in plan.py, maps to the GTFS route)
 *   mode   – "cable" | "rail" | "bus" | "owl"
 *   risk   – true for low-frequency lines that need slack in the schedule
 *   option – only included when that option is on ("owl", "event", "earlybird")
 *   note   – optional tip shown on the leg
 * Order here is just the planner's starting point.
 */
window.MUNI_DATA = {
  finish: { name: "Bus Stop (bar), 1901 Union St", at: [37.79796, -122.43098] },

  options: {
    owl: {
      label: "Include Owl lines",
      hint: "Adds the four overnight-only routes, ridden before the cable cars. Turns the day into a ~20-hour outing.",
    },
    event: {
      label: "Chase Center event day",
      hint: "The 78X 16th St Arena Express only runs around Chase Center events (and isn't in SFMTA's regular schedule data).",
    },
    earlybird: {
      label: "Completist: 714 BART Early Bird",
      hint: "A single pre-dawn trip to Balboa Park BART. Only makes sense with Owl lines on.",
      requires: "owl",
    },
  },

  lines: [
    { line: "Powell–Hyde Cable Car", mode: "cable", note: "Ride well past the Mason split so it counts as its own line." },
    { line: "Powell–Mason Cable Car", mode: "cable", note: "Distinct trackage from the Hyde line." },
    { line: "California Cable Car", mode: "cable" },
    { line: "49 Van Ness/Mission", mode: "bus" },
    { line: "19 Polk", mode: "bus" },
    { line: "1 California", mode: "bus", note: "Covers the 1X." },
    { line: "2 Sutter", mode: "bus" },
    { line: "24 Divisadero", mode: "bus" },
    { line: "22 Fillmore", mode: "bus" },
    { line: "38 Geary", mode: "bus", note: "Covers the 38R." },
    { line: "43 Masonic", mode: "bus" },
    { line: "5 Fulton", mode: "bus", note: "Covers the 5R." },
    { line: "7 Haight/Noriega", mode: "bus" },
    { line: "N Judah", mode: "rail" },
    { line: "66 Quintara", mode: "bus" },
    { line: "L Taraval", mode: "rail" },
    { line: "48 Quintara/24th St", mode: "bus" },
    { line: "29 Sunset", mode: "bus" },
    { line: "K Ingleside", mode: "rail" },
    { line: "M Ocean View", mode: "rail" },
    { line: "57 Parkmerced", mode: "bus" },
    { line: "58 Lake Merced", mode: "bus", risk: true, note: "Infrequent — check live arrivals before committing." },
    { line: "18 46th Ave", mode: "bus" },
    { line: "36 Teresita", mode: "bus", risk: true, note: "Infrequent — good place to have slack." },
    { line: "37 Corbett", mode: "bus", risk: true, note: "Steep, slow and infrequent." },
    { line: "35 Eureka", mode: "bus" },
    { line: "J Church", mode: "rail" },
    { line: "33 Ashbury/18th St", mode: "bus" },
    { line: "14 Mission", mode: "bus", note: "Covers the 14R." },
    { line: "67 Bernal Heights", mode: "bus", risk: true, note: "Low frequency, hilly loop — build in slack." },
    { line: "23 Monterey", mode: "bus" },
    { line: "52 Excelsior", mode: "bus" },
    { line: "54 Felton", mode: "bus" },
    { line: "9 San Bruno", mode: "bus", note: "Covers the 9R." },
    { line: "8 Bayshore", mode: "bus", note: "Covers the 8AX/8BX." },
    { line: "56 Rutland", mode: "bus", risk: true, note: "One of the least frequent lines in the system." },
    { line: "T Third Street", mode: "rail" },
    { line: "15 Bayview Hunters Point Express", mode: "bus" },
    { line: "55 Dogpatch", mode: "bus" },
    { line: "44 O'Shaughnessy", mode: "bus" },
    { line: "12 Folsom/Pacific", mode: "bus" },
    { line: "27 Bryant", mode: "bus" },
    { line: "30 Stockton", mode: "bus", note: "Covers the 30X." },
    { line: "39 Coit", mode: "bus" },
    { line: "F Market & Wharves", mode: "rail", note: "Historic streetcar." },
    { line: "25 Treasure Island", mode: "bus", note: "Round trip over the Bay Bridge — stay on (or catch the next one) back to the city." },
    { line: "6 Hayes/Parnassus", mode: "bus" },
    { line: "31 Balboa", mode: "bus" },
    { line: "28 19th Avenue", mode: "bus", note: "Covers the 28R." },
    { line: "45 Union/Stockton", mode: "bus" },

    { line: "90 San Bruno Owl", mode: "owl", option: "owl" },
    { line: "91 3rd St/19th Ave Owl", mode: "owl", option: "owl", note: "The longest Owl run." },
    { line: "L Owl", mode: "owl", option: "owl" },
    { line: "N Owl", mode: "owl", option: "owl" },
    { line: "714 BART Early Bird", mode: "owl", option: "earlybird", note: "One bus, one direction, one trip — pure completism." },
    { line: "78X 16th St Arena Express", mode: "bus", option: "event", note: "Event days only; not in SFMTA's schedule data, so the stop and timing are approximate. Fit it in near Chase Center." },
  ],

  // Lines the GTFS feed doesn't cover get hand-placed geometry here.
  manual: {
    "78X 16th St Arena Express": {
      board: { name: "16th St & 3rd St", ll: [37.7666, -122.3893] },
      alight: { name: "Chase Center", ll: [37.7680, -122.3877] },
    },
  },

  excluded: [
    "S Shuttle and the K/L/M/N/T “Bus” substitutes — rail-replacement duplicates, not standalone routes.",
    "BART, Caltrain, Golden Gate Transit, AC Transit, ferries — this is Muni-only.",
  ],

  caveats: [
    "Times come from SFMTA's scheduled weekday timetable, not live predictions. Buses run late; use the live-arrival links on each stop and adjust as you go.",
    "The real risk is the low-frequency lines flagged ⚠ (58, 36, 37, 67, 56). Miss one and you can lose 20–30 minutes.",
    "Walk limits are checked as straight-line distance (~450 m ≈ 5 blocks); actual street routes can be a bit longer, especially on hills.",
  ],
};
