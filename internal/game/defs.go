package game

// All balance numbers live in this file. The exported Defs value is sent to
// clients verbatim in the `welcome` message (see docs/PROTOCOL.md), so fields
// tagged `json:"-"` are server-only tuning knobs.

// Level is one level of a tower. Only the stats that apply are present.
type Level struct {
	Cost   int     `json:"cost"`             // build cost (level 1) or upgrade cost (2, 3)
	Range  float64 `json:"range"`            // targeting / effect radius, map px
	Dmg    float64 `json:"dmg,omitempty"`    // damage per hit
	Rate   float64 `json:"rate,omitempty"`   // shots per second at zero tension
	Splash float64 `json:"splash,omitempty"` // mortar splash radius
	Chains int     `json:"chains,omitempty"` // tesla: max targets per zap
	Slow   float64 `json:"slow,omitempty"`   // chrono: 0..1 speed reduction
}

// TowerDef describes a tower kind.
type TowerDef struct {
	Name   string  `json:"name"`
	Desc   string  `json:"desc"`
	Levels []Level `json:"levels"`
	// Wind says what tension improves: "rate" (fire rate × (1 + windBonus ×
	// tension)) or "range" (radius × (1 + windRangeBonus × tension); chrono).
	Wind         string  `json:"wind"`
	GroundOnly   bool    `json:"groundOnly,omitempty"`   // cannot target flyers
	IgnoresArmor bool    `json:"ignoresArmor,omitempty"` // damage bypasses armour
	ChainRange   float64 `json:"chainRange,omitempty"`   // tesla: max hop distance
	ShotSpeed    float64 `json:"-"`                      // px/s, for travel time (0 = instant)
	ShotTravel   float64 `json:"-"`                      // fixed travel time (mortar arc)
}

// EnemyDef describes an enemy kind.
type EnemyDef struct {
	Name        string  `json:"name"`
	Desc        string  `json:"desc"`
	HP          float64 `json:"hp"` // base HP before wave and player scaling
	Speed       float64 `json:"speed"`
	Flying      bool    `json:"flying"`
	Armor       float64 `json:"armor"`
	Lives       int     `json:"lives"`
	Bounty      int     `json:"bounty"`
	Radius      float64 `json:"radius"`
	Boss        bool    `json:"boss,omitempty"`
	Repair      float64 `json:"repair,omitempty"`      // HP/s healed on nearby allies
	RepairRange float64 `json:"repairRange,omitempty"` // radius of the repair aura
}

// Group is one stream of enemies within a wave.
type Group struct {
	Kind     string  `json:"kind"`
	N        int     `json:"n"`
	Paths    []int   `json:"paths"`    // enemy i walks Paths[i % len]
	Delay    float64 `json:"delay"`    // seconds after wave start
	Interval float64 `json:"interval"` // seconds between spawns
	HPMul    float64 `json:"hpMul"`    // overrides the wave's HPMul if > 0 (bosses)
}

// WaveDef is one hand-shaped wave.
type WaveDef struct {
	HPMul  float64 `json:"hpMul"` // HP multiplier on top of player scaling
	Bonus  int     `json:"bonus"` // total wave-clear bonus, split among connected players
	Groups []Group `json:"groups"`
}

// DefsT is the full balance table.
type DefsT struct {
	Towers     map[string]*TowerDef `json:"towers"`
	Enemies    map[string]*EnemyDef `json:"enemies"`
	TowerOrder []string             `json:"towerOrder"`
	EnemyOrder []string             `json:"enemyOrder"`
	MaxLives   int                  `json:"maxLives"`
	Waves      int                  `json:"waves"`
	SellRefund float64              `json:"sellRefund"`
	WindPerTap float64              `json:"windPerTap"`
	WindBonus  float64              `json:"windBonus"`

	// Additive fields (documented in PROTOCOL.md).
	WindRangeBonus float64 `json:"windRangeBonus"` // chrono radius bonus at full tension
	TensionDecay   float64 `json:"tensionDecay"`   // tension lost per second
	MaxTapsPerSec  float64 `json:"maxTapsPerSec"`  // server cap on winding taps per player
	BuildTime      float64 `json:"buildTime"`      // seconds of build phase
	MaxPlayers     int     `json:"maxPlayers"`
	HPPerPlayer    float64 `json:"hpPerPlayer"` // enemy HP × (1 + this × (players − 1))

	// Server-only knobs.
	MinDmgFrac      float64   `json:"-"` // armour never reduces a hit below this fraction
	StartPurseTotal float64   `json:"-"` // team starting cogs, split per player...
	StartPurseMin   float64   `json:"-"` // ...but never less than this each
	CatchUpFrac     float64   `json:"-"` // late joiner gets this × average net worth
	WaveDefs        []WaveDef `json:"-"`
}

// Defs is the single source of balance truth.
var Defs = &DefsT{
	Towers: map[string]*TowerDef{
		"rivet": {
			Name: "Rivet Gun", Desc: "Fast single-target shots. Hits ground and air.",
			Wind: "rate", ShotSpeed: 1400,
			Levels: []Level{
				{Cost: 50, Range: 190, Dmg: 8, Rate: 2.4},
				{Cost: 60, Range: 205, Dmg: 14, Rate: 2.7},
				{Cost: 110, Range: 220, Dmg: 24, Rate: 3.0},
			},
		},
		"mortar": {
			Name: "Steam Mortar", Desc: "Slow, long-range splash. Cannot hit flyers.",
			Wind: "rate", GroundOnly: true, ShotTravel: 0.6,
			Levels: []Level{
				{Cost: 120, Range: 280, Dmg: 34, Rate: 0.45, Splash: 65},
				{Cost: 130, Range: 300, Dmg: 60, Rate: 0.5, Splash: 75},
				{Cost: 220, Range: 320, Dmg: 100, Rate: 0.55, Splash: 85},
			},
		},
		"tesla": {
			Name: "Tesla Coil", Desc: "Chain lightning that ignores armour.",
			Wind: "rate", IgnoresArmor: true, ChainRange: 120,
			Levels: []Level{
				{Cost: 150, Range: 165, Dmg: 18, Rate: 0.8, Chains: 3},
				{Cost: 160, Range: 175, Dmg: 28, Rate: 0.9, Chains: 4},
				{Cost: 260, Range: 185, Dmg: 44, Rate: 1.0, Chains: 5},
			},
		},
		"chrono": {
			Name: "Chrono Pendulum", Desc: "No damage. Slows everything in its radius; winding widens it.",
			Wind: "range",
			Levels: []Level{
				{Cost: 100, Range: 150, Slow: 0.3},
				{Cost: 110, Range: 165, Slow: 0.4},
				{Cost: 180, Range: 180, Slow: 0.5},
			},
		},
	},
	Enemies: map[string]*EnemyDef{
		"scrap":  {Name: "Scrapling", Desc: "Baseline walker.", HP: 42, Speed: 60, Lives: 1, Bounty: 5, Radius: 14},
		"roach":  {Name: "Clockroach", Desc: "Fast and fragile; comes in swarms.", HP: 16, Speed: 100, Lives: 1, Bounty: 2, Radius: 10},
		"brute":  {Name: "Brass Brute", Desc: "Slow, tough, armoured.", HP: 240, Speed: 40, Armor: 3, Lives: 2, Bounty: 14, Radius: 20},
		"drone":  {Name: "Aero-Drone", Desc: "Flies. Mortars cannot hit it.", HP: 60, Speed: 70, Flying: true, Lives: 1, Bounty: 6, Radius: 14},
		"tinker": {Name: "Tinker", Desc: "Repairs nearby enemies. Kill it first.", HP: 90, Speed: 48, Armor: 2, Lives: 1, Bounty: 10, Radius: 15, Repair: 8, RepairRange: 110},
		"baron":  {Name: "Iron Baron", Desc: "Boss. Huge, armoured; costs 10 lives.", HP: 1500, Speed: 28, Armor: 3, Lives: 10, Bounty: 150, Radius: 32, Boss: true},
	},
	TowerOrder: []string{"rivet", "mortar", "tesla", "chrono"},
	EnemyOrder: []string{"scrap", "roach", "brute", "drone", "tinker", "baron"},
	MaxLives:   20,
	Waves:      15,
	SellRefund: 0.6,
	WindPerTap: 0.05,
	WindBonus:  0.75,

	WindRangeBonus: 0.3,
	TensionDecay:   1.0 / 25,
	MaxTapsPerSec:  10,
	BuildTime:      20,
	MaxPlayers:     8,
	HPPerPlayer:    0.06,

	MinDmgFrac:      0.2,
	StartPurseTotal: 320,
	StartPurseMin:   80,
	CatchUpFrac:     0.5,
	WaveDefs:        waves,
}

var (
	all    = []int{0, 1, 2}
	westRd = []int{0}
	gearLn = []int{1}
	fndSt  = []int{2}
)

func p(paths ...int) []int { return paths }

// Paths: 0 = West Road (long), 1 = Gearworks Lane (longest), 2 = Foundry Street (short).
var waves = []WaveDef{
	{HPMul: 1.0, Bonus: 80, Groups: []Group{ // 1
		{Kind: "scrap", N: 12, Paths: all, Interval: 1.4},
	}},
	{HPMul: 1.2, Bonus: 60, Groups: []Group{ // 2: roaches appear
		{Kind: "scrap", N: 12, Paths: all, Interval: 1.3},
		{Kind: "roach", N: 8, Paths: fndSt, Delay: 12, Interval: 0.5},
	}},
	{HPMul: 1.5, Bonus: 70, Groups: []Group{ // 3
		{Kind: "scrap", N: 16, Paths: all, Interval: 1.0},
		{Kind: "roach", N: 12, Paths: p(0, 1), Delay: 6, Interval: 0.5},
	}},
	{HPMul: 1.65, Bonus: 80, Groups: []Group{ // 4: brutes appear
		{Kind: "scrap", N: 14, Paths: all, Interval: 1.0},
		{Kind: "brute", N: 3, Paths: all, Delay: 5, Interval: 5},
		{Kind: "roach", N: 10, Paths: fndSt, Delay: 14, Interval: 0.4},
	}},
	{HPMul: 2.05, Bonus: 90, Groups: []Group{ // 5: roach rush
		{Kind: "roach", N: 30, Paths: all, Interval: 0.3},
		{Kind: "scrap", N: 16, Paths: all, Delay: 6, Interval: 0.8},
		{Kind: "brute", N: 4, Paths: p(0, 2), Delay: 12, Interval: 4},
	}},
	{HPMul: 2.45, Bonus: 100, Groups: []Group{ // 6: drones appear
		{Kind: "scrap", N: 18, Paths: all, Interval: 0.8},
		{Kind: "drone", N: 8, Paths: p(1, 2), Delay: 6, Interval: 1.5},
		{Kind: "brute", N: 4, Paths: p(0, 1), Delay: 10, Interval: 4},
	}},
	{HPMul: 2.75, Bonus: 110, Groups: []Group{ // 7
		{Kind: "scrap", N: 20, Paths: all, Interval: 0.7},
		{Kind: "roach", N: 30, Paths: all, Delay: 4, Interval: 0.3},
		{Kind: "drone", N: 10, Paths: all, Delay: 10, Interval: 1.0},
	}},
	{HPMul: 3.05, Bonus: 150, Groups: []Group{ // 8: first Iron Baron
		{Kind: "scrap", N: 24, Paths: all, Interval: 0.7},
		{Kind: "baron", N: 1, Paths: westRd, Delay: 6, Interval: 1, HPMul: 1.8},
		{Kind: "brute", N: 4, Paths: p(1, 2), Delay: 9, Interval: 4},
		{Kind: "drone", N: 12, Paths: p(1, 2), Delay: 15, Interval: 0.9},
	}},
	{HPMul: 3.4, Bonus: 130, Groups: []Group{ // 9: tinkers appear
		{Kind: "scrap", N: 20, Paths: all, Interval: 0.7},
		{Kind: "tinker", N: 3, Paths: all, Delay: 4, Interval: 3},
		{Kind: "brute", N: 8, Paths: all, Delay: 5, Interval: 2.2},
		{Kind: "drone", N: 10, Paths: p(0, 2), Delay: 12, Interval: 0.9},
	}},
	{HPMul: 3.6, Bonus: 140, Groups: []Group{ // 10: swarm
		{Kind: "roach", N: 70, Paths: all, Interval: 0.15},
		{Kind: "drone", N: 26, Paths: all, Delay: 4, Interval: 0.6},
		{Kind: "tinker", N: 4, Paths: all, Delay: 8, Interval: 2.5},
		{Kind: "brute", N: 7, Paths: all, Delay: 6, Interval: 2},
	}},
	{HPMul: 3.75, Bonus: 150, Groups: []Group{ // 11: armour column
		{Kind: "brute", N: 13, Paths: all, Interval: 1.6},
		{Kind: "tinker", N: 6, Paths: all, Delay: 3, Interval: 3},
		{Kind: "scrap", N: 24, Paths: all, Delay: 6, Interval: 0.6},
	}},
	{HPMul: 3.95, Bonus: 160, Groups: []Group{ // 12: air raid
		{Kind: "drone", N: 36, Paths: all, Interval: 0.5},
		{Kind: "roach", N: 50, Paths: all, Delay: 6, Interval: 0.15},
		{Kind: "tinker", N: 4, Paths: all, Delay: 9, Interval: 3},
		{Kind: "brute", N: 8, Paths: all, Delay: 8, Interval: 1.8},
	}},
	{HPMul: 4.1, Bonus: 170, Groups: []Group{ // 13
		{Kind: "brute", N: 14, Paths: all, Interval: 1.5},
		{Kind: "tinker", N: 6, Paths: all, Delay: 2, Interval: 2.5},
		{Kind: "roach", N: 30, Paths: all, Delay: 8, Interval: 0.2},
		{Kind: "drone", N: 12, Paths: all, Delay: 12, Interval: 0.7},
	}},
	{HPMul: 4.25, Bonus: 180, Groups: []Group{ // 14
		{Kind: "scrap", N: 24, Paths: all, Interval: 0.5},
		{Kind: "brute", N: 13, Paths: all, Delay: 3, Interval: 1.5},
		{Kind: "tinker", N: 6, Paths: all, Delay: 6, Interval: 2.5},
		{Kind: "drone", N: 14, Paths: all, Delay: 9, Interval: 0.7},
		{Kind: "roach", N: 30, Paths: all, Delay: 15, Interval: 0.15},
	}},
	{HPMul: 4.45, Bonus: 0, Groups: []Group{ // 15: twin Barons
		{Kind: "brute", N: 12, Paths: all, Interval: 1.6},
		{Kind: "baron", N: 2, Paths: p(0, 1), Delay: 3, Interval: 10, HPMul: 2.5},
		{Kind: "tinker", N: 6, Paths: all, Delay: 4, Interval: 3},
		{Kind: "drone", N: 16, Paths: all, Delay: 9, Interval: 0.7},
		{Kind: "roach", N: 36, Paths: all, Delay: 14, Interval: 0.15},
		{Kind: "scrap", N: 20, Paths: all, Delay: 18, Interval: 0.5},
	}},
}
