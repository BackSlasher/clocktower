package catapultcoop

import "fmt"

// All balance numbers live in this file (layouts: layout.go). The exported
// Defs value is sent to clients verbatim as `defs` (see docs/PROTOCOL.md,
// "catapult_coop"); fields tagged `json:"-"` are server-only knobs.

// BombDef describes a bomb kind.
type BombDef struct {
	Name   string `json:"name"`
	Desc   string `json:"desc"`
	Dmg    int    `json:"dmg,omitempty"`    // keg: to the machine nearest the wall; grapeshot: to every machine in the lane
	Freeze int    `json:"freeze,omitempty"` // stopwatch: advances every machine in the lane skips
}

// MachineDef describes a machine kind.
type MachineDef struct {
	Name  string `json:"name"`
	Desc  string `json:"desc"`
	HP    int    `json:"hp"`    // base hit points (a level group may add per-player HP)
	Speed int    `json:"speed"` // lane cells per advance
	Every int    `json:"every"` // advances only every Nth round (1 = every round)
	Dmg   int    `json:"dmg"`   // wall damage on arrival
	Boss  bool   `json:"boss,omitempty"`
}

// Group is one stream of machines in a level script. With n active players
// it spawns Counts[n−1] times (the last entry for larger n), the i-th time
// in turn Start + (i div Batch)×Every on lane Lanes[i mod len(Lanes)],
// Cluster machines each time (Batch and Cluster default 1). Turn 0 is the
// level start (visible in the first plan phase).
type Group struct {
	Kind    string
	Counts  []int // by active players: 1, 2, 3, 4
	Lanes   []int
	Start   int
	Every   int
	Batch   int
	Cluster int
	HP      []int // optional: hit points by active players (else the machine's HP)
}

// LevelDef is one level: a layout of the keep's interior, the bomb kinds that
// can appear, and the machine script.
type LevelDef struct {
	Name     string         `json:"name"`
	Desc     string         `json:"desc"`
	Layout   string         `json:"layout"`   // layout id within the keep (see layout.go)
	PlanTime float64        `json:"planTime"` // seconds of a plan phase in this level (set from planTimes)
	Bombs    map[string]int `json:"bombs"`    // kind → spawn weight; kinds absent never appear
	Groups   []Group        `json:"-"`
}

// DefsT is the full balance table.
type DefsT struct {
	MaxPlayers     int                    `json:"maxPlayers"`
	WallHP         int                    `json:"wallHP"`
	Slots          int                    `json:"slots"`       // actions per player per turn
	PlanTime       float64                `json:"planTime"`    // seconds of a plan phase in the first level (each level has its own: levels[].planTime)
	BreakTime      float64                `json:"breakTime"`   // seconds of the break between levels
	BreakHeal      int                    `json:"breakHeal"`   // wall hit points restored at each break (up to wallHP)
	ResolveBase    float64                `json:"resolveBase"` // resolve: resolveBase + stageTime × non-empty slot stages + machineTime
	StageTime      float64                `json:"stageTime"`
	MachineTime    float64                `json:"machineTime"`    // length of the machine stage when it has events
	ThrowRange     int                    `json:"throwRange"`     // cap on a throw's flight; larger than any keep = unlimited
	AwayAfter      int                    `json:"awayAfter"`      // missed rounds in a row before an engineer sits down
	BombsBase      int                    `json:"bombsBase"`      // bombs kept on the ground: bombsBase + bombsPerPlayer × active players
	BombsPerPlayer int                    `json:"bombsPerPlayer"` //
	Bombs          map[string]*BombDef    `json:"bombs"`
	BombOrder      []string               `json:"bombOrder"`
	Machines       map[string]*MachineDef `json:"machines"`
	MachineOrder   []string               `json:"machineOrder"`
	Levels         []*LevelDef            `json:"levels"`
}

var all4 = []int{0, 1, 2, 3}

// Defs is the single source of balance truth.
var Defs = &DefsT{
	MaxPlayers:     4,
	WallHP:         20,
	Slots:          4,
	PlanTime:       planTimes[0],
	BreakTime:      6,
	BreakHeal:      0,
	ResolveBase:    0.4,
	StageTime:      0.35,
	MachineTime:    0.6,
	ThrowRange:     20,
	AwayAfter:      2,
	BombsBase:      2,
	BombsPerPlayer: 1,
	Bombs: map[string]*BombDef{
		"keg":       {Name: "Powder Keg", Dmg: 2},
		"grapeshot": {Name: "Grapeshot", Dmg: 1},
		"stopwatch": {Name: "Stopwatch", Freeze: 2},
	},
	BombOrder: []string{"keg", "grapeshot", "stopwatch"},
	Machines: map[string]*MachineDef{
		"scrap": {Name: "Scrapling", Desc: "Small and steady.", HP: 1, Speed: 1, Every: 1, Dmg: 1},
		"roach": {Name: "Clockroach", Desc: "Fast; comes in clusters.", HP: 1, Speed: 2, Every: 1, Dmg: 1},
		"brute": {Name: "Brass Brute", Desc: "Tough.", HP: 4, Speed: 1, Every: 1, Dmg: 2},
		"baron": {Name: "Iron Baron", Desc: "The boss; tougher for bigger teams.", HP: 9, Speed: 1, Every: 1, Dmg: 3, Boss: true},
	},
	MachineOrder: []string{"scrap", "roach", "brute", "baron"},
	// Lanes: 0 and 1 leave the top rampart (catapults (3,0) and (6,0)), 2
	// and 3 the left one ((0,3) and (0,6)). Seat 2 guards the top rampart and
	// seat 4 the left one, so teams of up to three are pressed mostly on the
	// top lanes and a team of four on both sides. Lanes are 4 cells: a
	// machine is in reach for four plan phases (a Clockroach for two).
	// Counts were tuned with the bot harness (docs/CATAPULT_COOP.md,
	// "Balance notes").
	Levels: []*LevelDef{
		{Name: "First Shots", Desc: "Scraplings, a few at a time. Pass the kegs up to the ramparts.", Layout: "open",
			Bombs: map[string]int{"keg": 1},
			Groups: []Group{
				//                     players: 1  2  3  4
				{Kind: "scrap", Counts: []int{0, 2, 2, 2}, Lanes: []int{1}, Start: 0, Every: 3},
				{Kind: "scrap", Counts: []int{1, 0, 0, 0}, Lanes: []int{1}, Start: 1}, // a lone engineer needs a head start
				{Kind: "scrap", Counts: []int{0, 1, 2, 1}, Lanes: []int{0}, Start: 1, Every: 3},
				{Kind: "scrap", Counts: []int{0, 0, 0, 2}, Lanes: []int{3}, Start: 0, Every: 3},
			}},
		{Name: "Two Fronts", Desc: "More Scraplings, closer together.", Layout: "crates",
			Bombs: map[string]int{"keg": 1},
			Groups: []Group{
				{Kind: "scrap", Counts: []int{2, 4, 3, 3}, Lanes: []int{0, 1}, Start: 0, Every: 1},
				{Kind: "scrap", Counts: []int{0, 0, 1, 1}, Lanes: []int{3}, Start: 1},
				{Kind: "scrap", Counts: []int{0, 0, 0, 1}, Lanes: []int{2}, Start: 3},
			}},
		{Name: "Roach Run", Desc: "Clockroach clusters. Grapeshot appears.", Layout: "platform",
			Bombs: map[string]int{"keg": 70, "grapeshot": 30},
			Groups: []Group{
				{Kind: "scrap", Counts: []int{1, 2, 2, 1}, Lanes: []int{1, 0}, Start: 0, Every: 1},
				{Kind: "scrap", Counts: []int{0, 0, 0, 2}, Lanes: []int{2, 3}, Start: 0, Every: 2},
				{Kind: "roach", Counts: []int{1, 1, 1, 1}, Lanes: []int{0}, Start: 1, Cluster: 2},
			}},
		{Name: "Brass Arrives", Desc: "The first Brutes. Stopwatches appear.", Layout: "split",
			Bombs: map[string]int{"keg": 60, "grapeshot": 25, "stopwatch": 15},
			Groups: []Group{
				{Kind: "scrap", Counts: []int{1, 3, 2, 4}, Lanes: []int{0, 3, 1, 2}, Start: 0, Every: 1},
				{Kind: "brute", Counts: []int{1, 1, 1, 1}, Lanes: []int{1, 3}, Start: 1, Every: 2},
			}},
		{Name: "Full Tilt", Desc: "Everything at once.", Layout: "crates",
			Bombs: map[string]int{"keg": 60, "grapeshot": 25, "stopwatch": 15},
			Groups: []Group{
				{Kind: "scrap", Counts: []int{2, 3, 3, 2}, Lanes: []int{0, 1}, Start: 0, Every: 1},
				{Kind: "scrap", Counts: []int{0, 0, 0, 1}, Lanes: []int{3}, Start: 1},
				{Kind: "roach", Counts: []int{0, 1, 1, 1}, Lanes: []int{1, 3}, Start: 2, Every: 2, Cluster: 2},
				{Kind: "brute", Counts: []int{0, 0, 1, 0}, Lanes: []int{0}, Start: 3},
			}},
		{Name: "The Iron Baron", Desc: "The Baron himself, with company.", Layout: "split",
			Bombs: map[string]int{"keg": 60, "grapeshot": 25, "stopwatch": 15},
			Groups: []Group{
				{Kind: "baron", Counts: []int{1}, HP: []int{3, 5, 4, 6}, Lanes: []int{0}, Start: 1},
				{Kind: "scrap", Counts: []int{2, 2, 2, 3}, Lanes: []int{1, 3, 2}, Start: 0, Every: 1},
			}},
	},
}

// planTimes are the plan-phase timers by level: long while the team is
// still learning, down to 40 s for the last level. The guided tutorial (level
// 1's prelude) and the game's first turn have no timer; every turn also ends
// as soon as everyone is done.
var planTimes = []float64{90, 70, 60, 50, 45, 40}

// PlanTime is the plan-phase timer of level lv (1-based).
func PlanTime(lv int) float64 {
	return Defs.Levels[min(max(lv, 1), len(Defs.Levels))-1].PlanTime
}

func init() {
	for i, ld := range Defs.Levels {
		ld.PlanTime = planTimes[min(i, len(planTimes)-1)]
	}
	k, g, s := Defs.Bombs["keg"], Defs.Bombs["grapeshot"], Defs.Bombs["stopwatch"]
	k.Desc = fmt.Sprintf("%d damage to the machine nearest the wall.", k.Dmg)
	g.Desc = fmt.Sprintf("%d damage to every machine in the lane.", g.Dmg)
	s.Desc = fmt.Sprintf("Every machine in the lane skips its next %d moves.", s.Freeze)
}

// count is how many times g spawns with n active players.
func (gr Group) count(n int) int { return byPlayers(gr.Counts, n) }

// hp is the hit points of g's machines with n active players.
func (gr Group) hp(n int) int {
	if len(gr.HP) == 0 {
		return Defs.Machines[gr.Kind].HP
	}
	return byPlayers(gr.HP, n)
}

func byPlayers(v []int, n int) int { return v[min(max(1, n), len(v))-1] }

func (gr Group) cluster() int { return max(1, gr.Cluster) }

// round is the turn of the group's i-th spawn.
func (gr Group) round(i int) int { return gr.Start + i/max(1, gr.Batch)*gr.Every }
