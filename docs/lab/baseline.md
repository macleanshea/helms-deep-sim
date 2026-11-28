# Lab results: baseline

1320 experiments (0 failed) in 500 s.

## Duel: 1,200 pts of one defender against one kind of attack

Each cell: light attack / heavy attack (1x and 2.5x the defenders' worth in threat points), as
`outcome stopped%/survived%`. W won outright, H held to the time limit, L lost.

### open

| defender | archer | berserker | mixed | troll | uruk | warg | mean stopped | mean survived |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| at | L 0/33 · L 0/33 | L 0/33 · L 0/33 | L 13/0 · L 12/0 | H 80/100 · H 81/100 | H 0/100 · H 0/100 | L 0/0 · L 0/0 | 0.27 | 44% |
| grenadier | W 100/100 · W 100/100 | W 100/100 · W 100/100 | W 100/100 · W 97/100 | W 100/100 · H 78/72 | W 100/100 · W 92/100 | W 100/100 · L 39/0 | 1.55 | 89% |
| howitzer | W 100/100 · H 90/100 | W 82/67 · L 65/33 | L 71/0 · L 68/0 | L 32/33 · L 31/33 | W 100/100 · W 96/100 | L 87/33 · L 69/0 | 1.27 | 50% |
| ifv | W 100/100 · H 86/100 | W 100/100 · W 100/80 | W 100/100 · W 91/100 | W 100/100 · L 47/33 | W 100/100 · W 91/100 | W 100/100 · L 80/7 | 1.53 | 85% |
| marksman | W 100/100 · W 100/100 | W 100/100 · W 100/100 | W 100/100 · W 95/76 | W 100/100 · L 53/1 | W 100/100 · W 97/100 | W 100/100 · W 100/100 | 1.64 | 90% |
| mg | W 100/100 · W 100/100 | W 100/100 · W 100/100 | W 100/100 · W 100/100 | W 100/100 · L 20/0 | W 100/100 · W 100/100 | W 100/100 · W 100/100 | 1.58 | 92% |
| mortar | H 94/83 · W 90/67 | L 68/33 · L 67/33 | L 67/0 · L 51/0 | H 31/20 · L 21/0 | W 100/100 · H 85/100 | L 30/0 · L 27/0 | 1.03 | 36% |
| rifle | W 100/100 · H 72/68 | W 100/100 · L 75/33 | W 90/89 · L 39/33 | H 20/47 · L 15/33 | W 78/100 · W 79/100 | W 100/100 · L 41/0 | 1.08 | 67% |
| tank | W 100/100 · W 100/100 | W 100/100 · L 71/33 | W 100/100 · H 94/100 | W 100/100 · W 100/100 | W 99/100 · H 83/100 | W 100/100 · W 91/67 | 1.62 | 92% |

### wire

| defender | berserker | mixed | uruk | warg | mean stopped | mean survived |
| --- | --- | --- | --- | --- | --- | --- |
| at | L 0/33 · L 0/33 | L 13/0 · L 12/0 | H 0/100 · H 0/100 | L 0/0 · L 0/0 | 0.05 | 33% |
| grenadier | W 100/100 · W 100/100 | W 100/100 · W 100/100 | W 100/100 · W 92/100 | W 100/100 · W 100/100 | 1.72 | 100% |
| howitzer | W 84/67 · L 72/33 | L 71/0 · L 69/0 | W 97/100 · W 97/100 | W 95/67 · L 86/33 | 1.44 | 50% |
| ifv | W 100/100 · W 100/100 | W 100/100 · W 91/100 | W 100/100 · H 76/100 | W 100/100 · W 100/100 | 1.65 | 100% |
| marksman | W 100/100 · W 100/100 | W 100/100 · W 100/99 | W 100/100 · W 100/100 | W 100/100 · W 100/100 | 1.75 | 100% |
| mg | W 100/100 · W 100/100 | W 100/100 · W 100/100 | W 100/100 · W 100/100 | W 100/100 · W 100/100 | 1.75 | 100% |
| mortar | L 77/33 · L 71/33 | L 73/0 · L 69/0 | W 96/100 · H 92/100 | L 66/0 · L 38/0 | 1.23 | 33% |
| rifle | W 100/100 · W 100/100 | W 90/95 · H 44/36 | W 78/100 · W 81/100 | W 100/100 · W 100/100 | 1.48 | 91% |
| tank | W 100/100 · L 78/33 | W 100/100 · H 90/100 | W 100/100 · H 82/100 | W 100/100 · W 96/67 | 1.58 | 88% |

### ramp

| defender | berserker | mixed | troll | uruk | mean stopped | mean survived |
| --- | --- | --- | --- | --- | --- | --- |
| at | L 0/33 · L 0/33 | L 13/0 · L 12/0 | H 81/100 · H 82/100 | H 0/100 · L 0/33 | 0.41 | 50% |
| grenadier | W 100/100 · W 98/100 | W 70/100 · H 63/100 | W 67/100 · H 60/94 | W 90/100 · H 91/100 | 1.38 | 99% |
| howitzer | L 53/33 · L 52/33 | L 63/0 · L 67/0 | H 48/67 · H 36/67 | H 61/100 · H 60/100 | 0.95 | 50% |
| ifv | W 100/100 · W 100/87 | W 100/100 · H 71/93 | W 100/100 · H 47/67 | W 100/100 · H 88/100 | 1.46 | 93% |
| marksman | W 100/100 · W 100/100 | W 100/100 · H 50/100 | W 100/100 · H 64/100 | W 100/100 · W 100/100 | 1.48 | 100% |
| mg | W 100/100 · W 100/100 | W 100/100 · W 88/100 | W 76/67 · H 32/67 | W 100/100 · W 100/100 | 1.47 | 92% |
| mortar | L 57/33 · L 52/33 | L 51/0 · L 42/0 | H 54/67 · H 39/67 | H 94/100 · H 89/100 | 1.01 | 50% |
| rifle | W 100/100 · W 100/85 | W 70/74 · H 48/56 | H 23/67 · H 8/67 | W 100/100 · W 99/100 | 1.16 | 81% |
| tank | W 100/100 · L 75/33 | W 100/100 · H 74/100 | W 100/100 · W 82/67 | W 100/100 · H 93/100 | 1.51 | 88% |

### wall

| defender | catapults | escalade | sappers | siege | towers | volley | mean stopped | mean survived |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| at | H 21/19 · L 7/0 | L 0/0 · L 0/0 | L 23/0 · L 18/0 | L 33/0 · L 32/0 | L 66/0 · L 48/0 | L 0/0 · L 0/0 | 0.34 | 2% |
| grenadier | L 41/0 · L 12/0 | W 100/100 · W 100/100 | W 100/100 · W 100/100 | W 100/98 · L 74/0 | W 97/97 · L 42/0 | W 100/100 · W 100/100 | 1.34 | 66% |
| howitzer | W 91/100 · L 69/0 | W 99/100 · L 91/0 | W 95/100 · H 89/100 | L 59/0 · L 56/0 | L 36/0 · L 32/0 | W 97/67 · L 88/0 | 1.28 | 39% |
| ifv | W 100/100 · L 50/0 | W 100/100 · H 84/80 | W 100/100 · W 100/100 | W 100/100 · L 60/13 | H 54/80 · H 40/40 | W 100/100 · W 100/100 | 1.36 | 76% |
| marksman | H 52/28 · L 26/0 | W 99/100 · W 100/100 | W 100/100 · W 100/100 | W 100/90 · W 100/100 | W 100/100 · L 61/0 | W 100/100 · W 100/100 | 1.47 | 77% |
| mg | H 67/37 · L 31/0 | W 100/100 · W 100/100 | W 100/100 · W 100/100 | W 100/99 · L 69/0 | W 100/100 · L 31/0 | W 100/100 · W 100/100 | 1.37 | 70% |
| mortar | W 94/67 · H 77/62 | W 93/55 · L 90/0 | W 100/100 · W 98/100 | L 55/0 · L 56/0 | L 33/0 · L 32/0 | W 97/67 · L 91/0 | 1.32 | 38% |
| rifle | H 42/22 · L 14/1 | W 100/100 · W 99/92 | W 100/100 · W 99/95 | W 100/94 · L 56/0 | W 100/100 · L 32/0 | W 100/100 · L 52/0 | 1.19 | 59% |
| tank | W 100/100 · H 72/100 | W 100/100 · L 60/22 | W 100/100 · H 86/100 | W 100/100 · H 69/33 | W 99/100 · L 31/0 | W 100/100 · H 68/100 | 1.30 | 80% |

### Worth by defender

Threat points stopped per requisition point (1.00: stopped its own worth), by setting, and how often it was not wiped out.

| defender | open | wire | ramp | wall | not lost |
| --- | --- | --- | --- | --- | --- |
| at | 0.27 | 0.05 | 0.41 | 0.34 | 33% |
| grenadier | 1.55 | 1.72 | 1.38 | 1.34 | 90% |
| howitzer | 1.27 | 1.44 | 0.95 | 1.28 | 47% |
| ifv | 1.53 | 1.65 | 1.46 | 1.36 | 92% |
| marksman | 1.64 | 1.75 | 1.48 | 1.47 | 94% |
| mg | 1.58 | 1.75 | 1.47 | 1.37 | 90% |
| mortar | 1.03 | 1.23 | 1.01 | 1.32 | 42% |
| rifle | 1.08 | 1.48 | 1.16 | 1.19 | 82% |
| tank | 1.62 | 1.58 | 1.51 | 1.30 | 88% |

## Marginal: a balanced 1,470 pt garrison on the wall, plus 400 pts of one thing

Against 3,000 threat points. Change from the garrison alone.

| added | attack | held | stopped | survived | change in stopped | change in survived |
| --- | --- | --- | --- | --- | --- | --- |
| at | escalade | 3/3 | 100% | 100% | +0 | +0 |
| base | escalade | 3/3 | 100% | 100% |  |  |
| cache | escalade | 3/3 | 100% | 100% | +0 | +0 |
| claymore | escalade | 3/3 | 100% | 100% | +0 | +0 |
| cmd | escalade | 3/3 | 100% | 100% | +0 | +0 |
| grenadier | escalade | 3/3 | 100% | 100% | +0 | +0 |
| hedgehog | escalade | 3/3 | 100% | 100% | +0 | +0 |
| howitzer | escalade | 3/3 | 100% | 100% | +0 | +0 |
| ifv | escalade | 3/3 | 100% | 100% | +0 | +0 |
| marksman | escalade | 3/3 | 100% | 100% | +0 | +0 |
| mg | escalade | 3/3 | 100% | 100% | +0 | +0 |
| mine | escalade | 3/3 | 100% | 100% | +0 | +0 |
| mortar | escalade | 3/3 | 100% | 100% | +0 | +0 |
| rifle | escalade | 3/3 | 100% | 100% | +0 | +0 |
| tank | escalade | 3/3 | 100% | 100% | +0 | +0 |
| wire | escalade | 3/3 | 100% | 100% | +0 | +0 |
| at | siege | 3/3 | 100% | 100% | +0 | +0 |
| base | siege | 3/3 | 100% | 100% |  |  |
| cache | siege | 3/3 | 100% | 100% | +0 | +0 |
| claymore | siege | 3/3 | 100% | 100% | +0 | +0 |
| cmd | siege | 3/3 | 100% | 100% | +0 | +0 |
| grenadier | siege | 3/3 | 100% | 100% | +0 | +0 |
| hedgehog | siege | 3/3 | 100% | 100% | +0 | +0 |
| howitzer | siege | 3/3 | 100% | 100% | +0 | +0 |
| ifv | siege | 3/3 | 100% | 100% | +0 | +0 |
| marksman | siege | 3/3 | 100% | 100% | +0 | +0 |
| mg | siege | 3/3 | 100% | 100% | +0 | +0 |
| mine | siege | 3/3 | 100% | 100% | +0 | +0 |
| mortar | siege | 3/3 | 100% | 100% | +0 | +0 |
| rifle | siege | 3/3 | 100% | 100% | +0 | +0 |
| tank | siege | 3/3 | 100% | 100% | +0 | +0 |
| wire | siege | 3/3 | 100% | 100% | +0 | +0 |

## Scale: n defenders in the open against 1.5 times their worth of Uruk-hai

Each cell: `outcome stopped%/survived%`.

| defender, drawn up as | 1 | 5 | 25 | 100 | 250 |
| --- | --- | --- | --- | --- | --- |
| grenadier block | W 92/100 | W 96/100 | W 100/100 | W 100/100 | W 100/100 |
| grenadier line | W 92/100 | W 96/100 | W 100/100 | W 100/100 | H 92/100 |
| mg block | W 100/100 | W 100/100 | W 100/100 | W 100/100 | W 100/100 |
| mg line | W 100/100 | W 100/100 | W 100/100 | W 100/100 | W 100/100 |
| rifle block | W 73/100 | H 93/100 | W 100/100 | W 100/100 | W 100/100 |
| rifle line | W 73/100 | H 93/100 | W 100/100 | W 80/100 | W 84/100 |

## Threat: the balanced garrison on the wall against equal threat points of each attack

| attack | 2,000 TP | 4,000 TP |
| --- | --- | --- |
| berserker | held 3/3, stopped 100%, survived 100% | held 3/3, stopped 100%, survived 100% |
| catapults | held 3/3, stopped 71%, survived 45% | held 3/3, stopped 100%, survived 100% |
| escalade | held 3/3, stopped 100%, survived 100% | held 3/3, stopped 96%, survived 100% |
| sappers | held 3/3, stopped 100%, survived 100% | held 3/3, stopped 100%, survived 100% |
| siege | held 3/3, stopped 100%, survived 100% | held 0/3, stopped 71%, survived 0% |
| towers | held 1/3, stopped 75%, survived 28% | held 0/3, stopped 35%, survived 0% |
| troll | held 3/3, stopped 99%, survived 100% | held 2/3, stopped 53%, survived 23% |
| uruk | held 3/3, stopped 100%, survived 100% | held 0/3, stopped 87%, survived 0% |
| volley | held 3/3, stopped 100%, survived 100% | held 3/3, stopped 92%, survived 71% |

