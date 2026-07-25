#!/usr/bin/env python3
"""Build one location page per Simcoe County municipality Wilkin Plumbing covers.

Output: site/plumber-<slug>/index.html  (plus site/sitemap.xml, site/robots.txt)

Every page is written from municipality-specific facts — who runs the water and
wastewater system, which settlements are serviced, which are on private wells and
septic — sourced from the municipality's own pages (cited at the bottom of each
page). That is deliberate: nine near-identical "plumber in X" pages is the exact
shape Google demotes as doorway pages. Differentiation here has to be real.

Scope is the 9 municipalities inside a ~40 minute drive of the Barrie shop.
Barrie and Orillia are covered by the homepage and are not generated here.

Usage:  python3 tools/build_locations.py [--check]
        --check  verify generated files are current without rewriting
"""

import argparse
import html
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site')
ORIGIN = 'https://wilkinplumbing.ca'

PHONE_HREF = 'tel:+17058882651'
PHONE_TEXT = '705 888 2651'

# ---------------------------------------------------------------------------
# Services offered — same eight as the homepage, phrased for a location page.
# ---------------------------------------------------------------------------
SERVICES = [
    ('Residential plumbing', 'Leaks, clogged drains, burst and failing pipes, taps and toilets.'),
    ('Commercial plumbing', 'Scheduled around your opening hours so the business keeps running.'),
    ('Backflow prevention', 'Cross-connection surveys, installs, repairs and annual testing for municipal compliance.'),
    ('Water heaters', 'Diagnosis, repair and replacement — tank and tankless, gas and electric.'),
    ('Sewer lines', 'Blockages, backups and tree-root infiltration traced and cleared.'),
    ('Water treatment', 'Softeners and filtration as an authorized Excalibur Water Systems dealer.'),
    ('Bathroom renovation', 'Full builds start to finish, including tile, electrical and general building work.'),
    ('Plumbing inspections', 'Visual inspection for buyers and owners, with a written fault list and fix plan.'),
]

REVIEW = (
    'Out of a 0-10 rating, I would give Roy from Wilkin Plumbing a 20. This man is without a '
    'doubt the best plumber I have ever dealt with in my 50 years of owning a home.',
    'Deborah Madrick · Google review',
)

# ---------------------------------------------------------------------------
# The municipalities. `servicing` and `sources` are the load-bearing fields —
# they are what make each page a different page rather than a template fill.
# ---------------------------------------------------------------------------
PLACES = [
{
  'slug': 'innisfil',
  'name': 'Innisfil',
  'kind': 'Town',
  'drive': 'About 15–20 minutes from the shop in Barrie',
  'lede': "I'm Roy — a licensed journeyman plumber working out of Barrie, and Innisfil is "
          "next door. Alcona to Cookstown, the lakeshore to the concession roads: residential "
          "and commercial, no call centre in between.",
  'facts': ['Licensed journeyman plumber', 'Backflow certified', 'Free estimates, often from photos'],
  'servicing': [
      "Innisfil is unusual in Simcoe County — water and wastewater are run by InnServices, the "
      "town's own municipal services corporation, rather than a county or provincial operator. "
      "Its systems cover Alcona, Stroud, Lefroy, Belle Ewart, Gilford, Cookstown, Churchill and "
      "Innisfil Heights, with the Lakeshore treatment plant sitting in Alcona.",
      "Outside those serviced pockets, plenty of Innisfil properties are still on private wells "
      "and septic — and the town's own watering restrictions exempt private well users, which "
      "tells you how many there are. Those two realities need different plumbing: pressure tanks, "
      "softeners and iron filtration on one side of the line, municipal pressure and sewer "
      "connections on the other.",
  ],
  'jobs': [
      ('New-build fixtures and finishing',
       'Alcona and Lefroy have absorbed a lot of new housing. I fit and finish fixtures, correct '
       'builder shortcuts, and sort the things that surface once a house has been lived in.'),
      ('Lakeshore and seasonal properties',
       'Belle Ewart, Big Cedar Point, Sandy Cove, Gilford and Leonard\'s Beach. Shutting a place '
       'down properly for winter and starting it back up in spring without a flooded floor.'),
      ('Well and pressure-tank work',
       'On the concessions outside the serviced areas — pumps, pressure tanks, softeners and '
       'filtration for the iron and hardness that comes with local groundwater.'),
      ('Commercial backflow testing',
       'Cross-connection surveys and annual testing on commercial premises, filed for municipal '
       'compliance. I hold the backflow certification and deal with the municipality directly.'),
  ],
  'places': ['Alcona', 'Stroud', 'Lefroy', 'Belle Ewart', 'Gilford', 'Cookstown', 'Churchill',
             'Sandy Cove', 'Big Cedar Point', 'Innisfil Heights', "Fennell's Corners", "Leonard's Beach"],
  'sources': [('InnServices — water and wastewater', 'https://innservices.co/'),
              ('Town of Innisfil — water, sewer and stormwater',
               'https://www.innisfil.ca/resident-services/water-sewer-stormwater')],
  'nearby': ['essa', 'bradford-west-gwillimbury', 'new-tecumseth'],
},
{
  'slug': 'springwater',
  'name': 'Springwater',
  'kind': 'Township',
  'drive': 'About 15 minutes from the shop in Barrie — Midhurst is on the city edge',
  'lede': "A licensed journeyman plumber based in Barrie, working across Springwater — Midhurst "
          "and Snow Valley through to Elmvale, Hillsdale and Phelpston. Residential and commercial.",
  'facts': ['Licensed journeyman plumber', 'Backflow certified', 'Free estimates, often from photos'],
  'servicing': [
      "Springwater's municipal water and wastewater servicing follows its settlement areas — "
      "Anten Mills, Centre Vespra, Elmvale, Hillsdale, Midhurst, Minesing, Phelpston and Snow "
      "Valley. Meters get read quarterly in Anten Mills, Midhurst, Centre Vespra, Snow Valley and "
      "parts of Hillsdale and Phelpston, which is a decent shorthand for where the municipal "
      "system actually reaches.",
      "Everywhere else in the township is private wells, and the Simcoe Muskoka District Health "
      "Unit recommends well owners test three times a year. Local groundwater runs hard, and iron "
      "and manganese are common — that combination is what quietly kills water heaters and "
      "furs up fixtures out here.",
  ],
  'jobs': [
      ('Softeners and filtration for well water',
       "Hard water with iron and manganese in it is the standard Springwater problem. I'm an "
       "authorized Excalibur Water Systems dealer, so I can supply and install the treatment "
       "rather than just diagnose it."),
      ('Pumps and pressure tanks',
       'Short-cycling, pressure loss and failed tanks on properties outside the serviced '
       'settlement areas.'),
      ('Older village housing stock',
       'Elmvale, Hillsdale and Phelpston have plenty of older homes — aged supply pipe, seized '
       'shutoffs and drain work that was never quite right.'),
      ('Midhurst and Snow Valley builds',
       'Newer housing on the Barrie edge: fixture installs, bathroom work and the snags that '
       'appear after a couple of winters.'),
  ],
  'places': ['Midhurst', 'Snow Valley', 'Anten Mills', 'Elmvale', 'Hillsdale', 'Minesing',
             'Phelpston', 'Centre Vespra', 'Orr Lake', 'Wyevale side roads'],
  'sources': [('Township of Springwater — water and sewer',
               'https://www.springwater.ca/living-here/water-and-sewer/'),
              ('Springwater — water quality and testing',
               'https://www.springwater.ca/living-here/water-and-sewer/water-quality-and-testing/')],
  'nearby': ['oro-medonte', 'essa', 'clearview'],
},
{
  'slug': 'oro-medonte',
  'name': 'Oro-Medonte',
  'kind': 'Township',
  'drive': 'About 20 minutes from the shop in Barrie',
  'lede': "Licensed journeyman plumber covering Oro-Medonte — Shanty Bay and Hawkestone along "
          "the lake, up through Craighurst, Horseshoe Valley, Warminster and Moonstone.",
  'facts': ['Licensed journeyman plumber', 'Backflow certified', 'Free estimates, often from photos'],
  'servicing': [
      "The township owns and operates a dozen municipal drinking water systems, but the majority "
      "of Oro-Medonte residents are still on private wells — and most properties, including Bass "
      "Lake, Shanty Bay, Edgar, Craighurst, Moonstone and the rural concessions, run on private "
      "septic. Horseshoe Valley is split: part of it is served by a private resort drinking water "
      "system rather than the municipal one.",
      "Oro-Medonte also runs a mandatory septic re-inspection program under the Ontario Building "
      "Code covering roughly 2,000 properties. If yours is coming up, what happens inside the "
      "house matters — leaking fixtures and a failing toilet flapper push hydraulic load onto a "
      "system that is about to be assessed.",
  ],
  'jobs': [
      ('Well, pump and pressure-tank work',
       'The default in Oro-Medonte. Pressure problems, short cycling, failed tanks, plus '
       'softeners and filtration for hard groundwater.'),
      ('Septic-conscious plumbing',
       'Fixture and drain work on homes with private septic, and fixing the internal leaks that '
       'load a system before a re-inspection.'),
      ('Horseshoe Valley and Sugarbush seasonal homes',
       'Ski-country properties that sit empty midweek. Winterizing, freeze protection and '
       'getting to a burst line before it becomes a ceiling.'),
      ('Lakeside Shanty Bay, Hawkestone and Oro Station',
       'Older waterfront housing stock, seasonal shutoffs and spring re-commissioning.'),
  ],
  'places': ['Shanty Bay', 'Hawkestone', 'Oro Station', 'Craighurst', 'Horseshoe Valley',
             'Sugarbush', 'Edgar', 'Warminster', 'Moonstone', 'Bass Lake', 'Rugby', 'Prices Corners'],
  'sources': [('Oro-Medonte — drinking water',
               'https://www.oro-medonte.ca/working-here/township-departments/environmental-services/drinking-water/'),
              ('Oro-Medonte — wastewater services',
               'https://www.oro-medonte.ca/working-here/township-departments/environmental-services/wastewater-services/')],
  'nearby': ['springwater', 'severn', 'ramara'],
},
{
  'slug': 'essa',
  'name': 'Essa',
  'kind': 'Township',
  'drive': 'About 20 minutes from the shop in Barrie',
  'lede': "Licensed journeyman plumber working across Essa Township — Angus, Thornton, Baxter "
          "and the rural concessions in between. Residential and commercial.",
  'facts': ['Licensed journeyman plumber', 'Backflow certified', 'Free estimates, often from photos'],
  'servicing': [
      "Municipal water in Essa is supplied inside Angus, Thornton and Baxter. Angus is the "
      "township's primary settlement area and the one with both municipal water and sanitary "
      "sewers; its municipal wells draw from a deep aquifer around Angus and CFB Borden, while "
      "Thornton's are set in shallower sand aquifers.",
      "Angus has run up against water and wastewater capacity limits that constrain new "
      "development — which in practice means a lot of the work here is on the housing that is "
      "already standing rather than on new subdivisions. Outside the three serviced communities, "
      "properties are on private wells and septic.",
  ],
  'jobs': [
      ('Angus homes and rental turnover',
       'Base-adjacent housing turns over often. Fast repairs between tenancies, fixture swaps '
       'and the inspection-and-fix-list work that comes with a change of occupant.'),
      ('Hard-water damage to water heaters',
       'Groundwater here is hard. Scaled and short-lived tanks, plus softeners and filtration '
       'supplied and installed as an Excalibur dealer.'),
      ('Commercial work along the Highway 90 corridor',
       'Backflow surveys, installs and annual testing filed for municipal compliance, scheduled '
       'around trading hours.'),
      ('Rural well and septic properties',
       'Pumps, pressure tanks and drainage on the concessions outside Angus, Thornton and Baxter.'),
  ],
  'places': ['Angus', 'Thornton', 'Baxter', 'Ivy', 'Utopia', 'Egbert', 'Colwell', 'CFB Borden area'],
  'sources': [('Township of Essa — living in Essa',
               'https://www.essatownship.on.ca/living-in-essa/'),
              ('Essa — notice to municipal water users in Angus, Thornton and Baxter',
               'https://www.essatownship.on.ca/news-notices/notice-to-municipal-water-users-in-angus-thornton-and-baxter-flushing-watermains-fall-2024/')],
  'nearby': ['innisfil', 'springwater', 'new-tecumseth', 'clearview'],
},
{
  'slug': 'bradford-west-gwillimbury',
  'name': 'Bradford West Gwillimbury',
  'short': 'Bradford',
  'kind': 'Town',
  'drive': 'About 35 minutes from the shop in Barrie',
  'lede': "Licensed journeyman plumber covering Bradford West Gwillimbury — Bradford, Bond Head, "
          "Newton Robinson and the Holland Marsh. Residential and commercial.",
  'facts': ['Licensed journeyman plumber', 'Backflow certified', 'Free estimates, often from photos'],
  'servicing': [
      "Bradford West Gwillimbury is fed by two different kinds of water. Zone 1 runs on "
      "groundwater from the protected deep Bradford Aquifer; Zone 2 is treated Lake Simcoe "
      "surface water bought from the Town of Innisfil and produced at the Alcona filtration "
      "plant. Bond Head is tied into Bradford by a trunk watermain along Line 8 and County Road 27.",
      "The Holland Marsh is serviced through a joint board shared with the Township of King. "
      "Marsh properties combine agricultural water use with domestic supply, which is precisely "
      "the situation cross-connection and backflow rules exist for.",
  ],
  'jobs': [
      ('Backflow prevention on agricultural and irrigation connections',
       'Holland Marsh operations with irrigation tied anywhere near a potable supply need a '
       'tested backflow preventer. I survey, install, repair and test, and file for compliance.'),
      ('Bradford subdivision housing',
       'Fixture installs, bathroom work and the faults that show up in fast-built housing once '
       'it has been through a few heating seasons.'),
      ('Bond Head and Newton Robinson older homes',
       'Village housing stock with aging supply pipe, seized shutoffs and drains that need '
       'rebuilding rather than snaking.'),
      ('Commercial premises',
       'Scheduled around opening hours, with annual backflow testing kept current.'),
  ],
  'places': ['Bradford', 'Bond Head', 'Newton Robinson', 'Holland Marsh', 'Ansnorveldt'],
  'sources': [('Town of Bradford West Gwillimbury — water supply',
               'https://www.townofbwg.com/en/living-in-bwg/water-supply.aspx')],
  'nearby': ['innisfil', 'new-tecumseth'],
},
{
  'slug': 'new-tecumseth',
  'name': 'New Tecumseth',
  'kind': 'Town',
  'drive': 'About 35 minutes from the shop in Barrie',
  'lede': "Licensed journeyman plumber covering New Tecumseth — Alliston, Beeton and Tottenham, "
          "plus the rural properties around them. Residential and commercial.",
  'facts': ['Licensed journeyman plumber', 'Backflow certified', 'Free estimates, often from photos'],
  'servicing': [
      "New Tecumseth draws its municipal water from eleven groundwater production wells — seven "
      "around Alliston, four around Tottenham, set between roughly 17 and 61 metres deep — "
      "supplemented by surface water piped in from Collingwood's Raymond A. Barker "
      "ultra-filtration plant through a 600 mm transmission main. Storage runs to about 27.4 "
      "million litres across six in-ground reservoirs and two elevated tanks.",
      "Wastewater is treated locally, including a rebuilt Tottenham plant discharging to Beeton "
      "Creek. Properties outside the three towns are on private wells and septic, and groundwater "
      "in this part of the county is hard enough to shorten the life of an untreated water heater.",
  ],
  'jobs': [
      ('Alliston housing, new and older',
       'A town that has grown in waves — I work on both the recent subdivisions and the older '
       'streets behind them.'),
      ('Industrial and commercial backflow',
       'Cross-connection surveys, preventer installs and the annual test certificates that keep '
       'a commercial or industrial site compliant.'),
      ('Beeton and Tottenham older homes',
       'Aged supply pipe, failing shutoffs, drain rebuilds and bathroom renovations taken start '
       'to finish.'),
      ('Rural wells and water treatment',
       'Pumps, pressure tanks, softeners and filtration outside the serviced areas — supplied and '
       'installed as an authorized Excalibur dealer.'),
  ],
  'places': ['Alliston', 'Beeton', 'Tottenham', 'Everett side roads', 'Rich Hill', 'Penville'],
  'sources': [('Town of New Tecumseth — water',
               'https://www.newtecumseth.ca/live-here/services/water-wastewater-stormwater/water/'),
              ('New Tecumseth — drinking water system annual report',
               'https://www.newtecumseth.ca/en/living-in-our-community/drinking-water.aspx')],
  'nearby': ['essa', 'innisfil', 'bradford-west-gwillimbury'],
},
{
  'slug': 'clearview',
  'name': 'Clearview',
  'kind': 'Township',
  'drive': 'About 35 minutes from the shop in Barrie',
  'lede': "Licensed journeyman plumber covering Clearview Township — Stayner, Creemore, Nottawa, "
          "New Lowell and the escarpment properties around Duntroon.",
  'facts': ['Licensed journeyman plumber', 'Backflow certified', 'Free estimates, often from photos'],
  'servicing': [
      "Clearview owns and operates six municipal residential water systems — Stayner, Creemore, "
      "New Lowell, Nottawa (McKean), Colling-Woodlands and Buckingham Woods — and every one of "
      "them is fed by groundwater wells rather than surface water. Wastewater is treated at the "
      "Stayner plant, which discharges to Lamont Creek, and at Creemore's newer membrane plant, "
      "which outfalls to the Mad River.",
      "Outside those six systems the township is well-and-septic country. Groundwater supply "
      "across the whole township means hardness is a constant, whether you are on a municipal "
      "well or your own.",
  ],
  'jobs': [
      ('Century homes in Creemore and Stayner',
       'Some of the oldest housing stock I work on. Galvanized supply replacement, drain rebuilds '
       'and bathrooms taken back to studs and rebuilt properly.'),
      ('Escarpment and rural properties',
       'Duntroon, Nottawa and the concessions: wells, pumps, pressure tanks and freeze-prone runs '
       'in unheated crawl spaces.'),
      ('Softeners and filtration',
       'Every municipal system here is groundwater-fed. Treatment supplied and installed as an '
       'authorized Excalibur Water Systems dealer.'),
      ('Recreational and second properties',
       'Places near the ski hills that sit empty for stretches — winterizing, freeze protection '
       'and spring startup.'),
  ],
  'places': ['Stayner', 'Creemore', 'Nottawa', 'New Lowell', 'Duntroon', 'Brentwood', 'Avening',
             'Sunnidale Corners', 'Glen Huron'],
  'sources': [('Township of Clearview — water and sewer',
               'https://www.clearview.ca/municipal-services/water-and-sewer'),
              ('Clearview — annual water system reports',
               'https://www.clearview.ca/municipal-services/water-and-sewer/water-sewer-reports-statements')],
  'nearby': ['springwater', 'essa'],
},
{
  'slug': 'severn',
  'name': 'Severn',
  'kind': 'Township',
  'drive': 'About 35 minutes from the shop in Barrie, and minutes from Orillia',
  'lede': "Licensed journeyman plumber covering Severn Township — Coldwater, Washago, Port "
          "Severn, Marchmont and the waterfront properties along the Severn River.",
  'facts': ['Licensed journeyman plumber', 'Backflow certified', 'Free estimates, often from photos'],
  'servicing': [
      "Severn is genuinely mixed. Coldwater and Washago have both municipal water and municipal "
      "sewer. Bass Lake Woodlands, Marchmont, Sandcastle Estates and Severn Estates get municipal "
      "water but no municipal wastewater — those homes are on septic despite being on a municipal "
      "supply. Ardtrea, Fesserton, Port Severn and Severn Falls are private wells and septic "
      "throughout.",
      "The township also runs an on-site sewage system inspection program: a system 40 years or "
      "older has to be pumped out by a licensed hauler to prove it still works. Internal leaks — a "
      "running toilet, a dripping fixture — are the cheapest thing to fix before that assessment.",
  ],
  'jobs': [
      ('Waterfront and cottage plumbing',
       'Port Severn, Severn Falls and the river properties. Proper winter shutdowns, drain-downs '
       'and spring re-commissioning without a flooded floor.'),
      ('Water-on-septic homes',
       'Municipal supply pressure into a private septic system is its own balance. Fixture and '
       'drainage work that respects what the system downstream can take.'),
      ('Ageing septic ahead of inspection',
       'Finding and fixing the internal leaks that load a system before a mandated pump-out and '
       'inspection.'),
      ('Wells, pumps and treatment',
       'Ardtrea, Fesserton and the rural roads — pumps, pressure tanks, softeners and filtration.'),
  ],
  'places': ['Coldwater', 'Washago', 'Port Severn', 'Severn Falls', 'Marchmont', 'Fesserton',
             'Ardtrea', 'Bass Lake Woodlands', 'Cumberland Beach', 'Uhthoff'],
  'sources': [('Township of Severn — water and sewer services',
               'https://www.severn.ca/our-community/water-and-sewer-services/'),
              ('Severn — septic inspection program',
               'https://www.severn.ca/en/build-and-invest/septic-inspection-program.aspx')],
  'nearby': ['oro-medonte', 'ramara'],
},
{
  'slug': 'ramara',
  'name': 'Ramara',
  'kind': 'Township',
  'drive': 'About 40 minutes from the shop in Barrie, just past Orillia',
  'lede': "Licensed journeyman plumber covering Ramara Township — Brechin, Lagoon City, "
          "Atherley-Uptergrove, Longford Mills and the hamlets out to Sebright.",
  'facts': ['Licensed journeyman plumber', 'Backflow certified', 'Free estimates, often from photos'],
  'servicing': [
      "Ramara owns two wastewater treatment facilities, serving Brechin, Lagoon City and Bayshore "
      "Village, with a septage receiving station at the Lagoon City plant on Laguna Parkway. The "
      "township's official plan sets out nine settlement areas: the villages of "
      "Atherley-Uptergrove, Brechin, Lagoon City and Longford Mills, and the limited-service "
      "hamlets of Cooper's Falls, Gamebridge, Sebright, Udney and Washago.",
      "Ramara has also been allocated provincial funding toward water and wastewater upgrades, "
      "including work at the Brechin and Lagoon City water treatment plant and at Bayshore "
      "Village. Outside the serviced villages, expect private wells and septic.",
  ],
  'jobs': [
      ('Lagoon City canal homes',
       'Waterfront housing on the canals, much of it seasonal. Winterizing, sump and backwater '
       'valve work, and getting a place going again in spring.'),
      ('Bayshore Village and Brechin',
       'Serviced village properties — fixtures, water heaters, drain work and bathroom '
       'renovations taken start to finish.'),
      ('Hamlet properties on wells and septic',
       'Udney, Sebright, Gamebridge and Longford Mills. Pumps, pressure tanks, softeners and '
       'filtration for hard rural groundwater.'),
      ('Atherley and Uptergrove',
       'Right on the Orillia edge, which is territory I already cover daily — quick to reach for '
       'anything urgent.'),
  ],
  'places': ['Brechin', 'Lagoon City', 'Atherley', 'Uptergrove', 'Longford Mills', 'Bayshore Village',
             'Udney', 'Sebright', 'Gamebridge', "Cooper's Falls", 'Washago'],
  'sources': [('Township of Ramara — sewer systems',
               'https://www.ramara.ca/living-here/sewer-systems/'),
              ('Ramara — provincial investment in water and wastewater infrastructure',
               'https://www.ramara.ca/news/posts/township-of-ramara-grateful-for-provincial-investment-in-water-and-wastewater-infrastructure/')],
  'nearby': ['severn', 'oro-medonte'],
},
]

BY_SLUG = {p['slug']: p for p in PLACES}

PHONE_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 '
             '19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 '
             '1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 '
             '0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>')
MAIL_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" '
            'rx="2"/><path d="m3 7 9 6 9-6"/></svg>')
PIN_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 '
           '0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>')
CLOCK_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/>'
             '<path d="M12 7v5l3 2"/></svg>')


def e(s):
    return html.escape(s, quote=True)


def render(p):
    name = p['name']
    short = p.get('short', name)
    url = '%s/plumber-%s/' % (ORIGIN, p['slug'])
    title = 'Plumber in %s | Wilkin Plumbing · %s' % (name, PHONE_TEXT)
    desc = ('Plumber in %s. Roy at Wilkin Plumbing — licensed journeyman, backflow certified, '
            'based in Barrie. Repairs, water heaters, wells and treatment, bathrooms. '
            'Call %s.' % (name, PHONE_TEXT))

    services = '\n'.join(
        '      <li class="card"><h3>%s</h3><p>%s</p></li>' % (e(t), e(d)) for t, d in SERVICES)
    jobs = '\n'.join(
        '      <li class="card"><h3>%s</h3><p>%s</p></li>' % (e(t), e(d)) for t, d in p['jobs'])
    places = '\n'.join('      <li>%s</li>' % e(x) for x in p['places'])
    facts = '\n'.join('        <li>%s</li>' % e(x) for x in p['facts'])
    servicing = '\n'.join('      <p>%s</p>' % e(x) for x in p['servicing'])
    sources = ' · '.join('<a href="%s" rel="nofollow noopener" target="_blank">%s</a>'
                         % (e(u), e(l)) for l, u in p['sources'])
    nearby = '\n'.join(
        '      <li><a href="/plumber-%s/">Plumber in %s</a></li>'
        % (s, e(BY_SLUG[s].get('short', BY_SLUG[s]['name']))) for s in p['nearby'])

    area_served = ', '.join('{"@type":"Place","name":"%s"}' % x.replace('"', '')
                            for x in [name] + p['places'])

    return TEMPLATE.format(
        title=e(title), desc=e(desc), url=url, name=e(name), short=e(short),
        kind=e(p['kind']), drive=e(p['drive']), lede=e(p['lede']),
        facts=facts, servicing=servicing, sources=sources,
        jobs=jobs, services=services, places=places, nearby=nearby,
        review=e(REVIEW[0]), review_by=e(REVIEW[1]),
        phone_href=PHONE_HREF, phone=PHONE_TEXT,
        phone_svg=PHONE_SVG, mail_svg=MAIL_SVG, pin_svg=PIN_SVG, clock_svg=CLOCK_SVG,
        area_served=area_served, origin=ORIGIN,
    )


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<link rel="icon" href="/brand/logo/wilkin-logo.png">
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{origin}/brand/photos/branding/wilkin-van-sunset.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Geist:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/location.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>

<nav class="nav" aria-label="Primary">
  <div class="nav-pill">
    <a class="brand" href="/" aria-label="Wilkin Plumbing home">
      <img src="/brand/logo/wilkin-logo.png" alt="Wilkin Plumbing logo" width="34" height="34">
      <span><b>Wilkin Plumbing</b><span class="sub">Barrie &amp; Orillia</span></span>
    </a>
    <a class="btn btn-primary" href="{phone_href}">{phone_svg}{phone}</a>
  </div>
</nav>

<div class="crumbs">
  <ol>
    <li><a href="/">Home</a></li>
    <li aria-current="page">Plumber in {name}</li>
  </ol>
</div>

<main id="main">

<header class="hero-loc">
  <div class="wrap">
    <span class="eyebrow">Simcoe County {kind}</span>
    <h1>Plumber in {name}</h1>
    <p class="lede">{lede}</p>
    <div class="hero-cta">
      <a class="btn btn-primary" href="{phone_href}">{phone_svg}Call {phone}</a>
      <a class="btn btn-ghost" href="mailto:info@wilkinplumbing.ca">Ask for a quote</a>
    </div>
    <ul class="hero-facts">
        <li>{drive}</li>
{facts}
    </ul>
  </div>
</header>

<section class="block">
  <div class="wrap two-col">
    <div>
      <span class="eyebrow">On the ground</span>
      <h2>What plumbing in {short} actually involves</h2>
{servicing}
      <p style="font-size:.86rem;color:rgba(255,255,255,.55)">Servicing details from {sources}.</p>
    </div>
    <aside class="glass">
      <h3>Straightforward pricing</h3>
      <div class="price-rows">
        <div class="price-row"><span>Service call<br><small style="color:rgba(255,255,255,.55)">Covers the first hour on site, materials separate</small></span><span class="amt">$140 + tax</span></div>
        <div class="price-row"><span>Set-price items</span><span class="amt">On request</span></div>
      </div>
      <p style="margin-top:14px">Most estimates are free — I can often quote from a few photos you send me. Bigger jobs get a site visit at no cost.</p>
    </aside>
  </div>
</section>

<section class="block">
  <div class="wrap">
    <span class="eyebrow">Common calls</span>
    <h2>What I get called out for in {short}</h2>
    <ul class="card-grid">
{jobs}
    </ul>
  </div>
</section>

<section class="block">
  <div class="wrap">
    <span class="eyebrow">Services</span>
    <h2>Everything I cover in {name}</h2>
    <ul class="card-grid">
{services}
    </ul>
  </div>
</section>

<section class="block">
  <div class="wrap">
    <span class="eyebrow">Coverage</span>
    <h2>Communities I cover in {short}</h2>
    <ul class="places">
{places}
    </ul>
  </div>
</section>

<section class="block">
  <div class="wrap two-col">
    <div class="glass">
      <span class="eyebrow">Get in touch</span>
      <h2>Book a plumber in {short}</h2>
      <p>Need a quote, got a question, or want to book a visit? Call and you get me — Roy — not a
         call centre.</p>
      <ul class="nap">
        <li>{phone_svg}<a href="{phone_href}"><span class="big">{phone}</span></a></li>
        <li>{mail_svg}<a href="mailto:info@wilkinplumbing.ca">info@wilkinplumbing.ca</a></li>
        <li>{clock_svg}<span>Daily, 6am to 10pm</span></li>
        <li>{pin_svg}<span>270 Kozlov St, Barrie, ON L4N 7H6<br><small>Serving Barrie, Orillia and Simcoe County</small></span></li>
      </ul>
    </div>
    <div>
      <span class="eyebrow">From Google</span>
      <blockquote class="quote">{review}<cite>{review_by}</cite></blockquote>
      <p><a href="/#reviews">Read more reviews</a> or <a href="/#work">see recent work</a>.</p>
    </div>
  </div>
</section>

<section class="block">
  <div class="wrap">
    <span class="eyebrow">Nearby</span>
    <h2>Other areas I cover</h2>
    <ul class="nearby">
{nearby}
      <li><a href="/">Barrie &amp; Orillia (home)</a></li>
    </ul>
  </div>
</section>

</main>

<footer class="site">
  <div class="wrap">
    <div class="foot-top">
      <img src="/brand/logo/wilkin-logo.png" alt="Wilkin Plumbing logo" width="42" height="42">
      <div><b>Wilkin Plumbing</b><span>Reliable plumbing you can trust</span></div>
    </div>
    <div class="foot-meta">
      <span>Licensed journeyman plumber</span>
      <span>Backflow certified</span>
      <span>Residential &amp; Commercial</span>
      <a href="{phone_href}">{phone}</a>
    </div>
    <p class="foot-legal">© 2026 Wilkin Plumbing. All rights reserved.</p>
  </div>
</footer>

<script type="application/ld+json">
{{
  "@context":"https://schema.org",
  "@type":"Plumber",
  "name":"Wilkin Plumbing",
  "url":"{url}",
  "image":"{origin}/brand/logo/wilkin-logo.png",
  "description":"Licensed journeyman plumber based in Barrie, serving {name} and Simcoe County. Residential and commercial plumbing, water heaters, backflow prevention, wells and water treatment, sewer lines, bathroom renovations.",
  "telephone":"+1-705-888-2651",
  "email":"info@wilkinplumbing.ca",
  "address":{{"@type":"PostalAddress","streetAddress":"270 Kozlov St","addressLocality":"Barrie","addressRegion":"ON","postalCode":"L4N 7H6","addressCountry":"CA"}},
  "areaServed":[{area_served}],
  "openingHoursSpecification":{{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],"opens":"06:00","closes":"22:00"}},
  "priceRange":"$$"
}}
</script>
<script type="application/ld+json">
{{
  "@context":"https://schema.org",
  "@type":"BreadcrumbList",
  "itemListElement":[
    {{"@type":"ListItem","position":1,"name":"Home","item":"{origin}/"}},
    {{"@type":"ListItem","position":2,"name":"Plumber in {name}","item":"{url}"}}
  ]
}}
</script>
</body>
</html>
"""


def build_sitemap():
    urls = ['%s/' % ORIGIN] + ['%s/plumber-%s/' % (ORIGIN, p['slug']) for p in PLACES]
    body = '\n'.join('  <url><loc>%s</loc></url>' % u for u in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            '%s\n</urlset>\n' % body)


def build_robots():
    return ('User-agent: *\n'
            'Allow: /\n\n'
            'Sitemap: %s/sitemap.xml\n' % ORIGIN)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true',
                    help='verify files match what would be generated; exit 1 if not')
    args = ap.parse_args()

    files = {}
    for p in PLACES:
        files[os.path.join(SITE, 'plumber-%s' % p['slug'], 'index.html')] = render(p)
    files[os.path.join(SITE, 'sitemap.xml')] = build_sitemap()
    files[os.path.join(SITE, 'robots.txt')] = build_robots()

    stale = []
    for path, content in sorted(files.items()):
        rel = os.path.relpath(path, ROOT)
        if args.check:
            existing = None
            if os.path.exists(path):
                with open(path, encoding='utf-8') as fh:
                    existing = fh.read()
            if existing != content:
                stale.append(rel)
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(content)
        print('wrote', rel)

    if args.check:
        if stale:
            print('stale:\n  ' + '\n  '.join(stale))
            return 1
        print('%d generated files are current' % len(files))
    return 0


if __name__ == '__main__':
    sys.exit(main())
