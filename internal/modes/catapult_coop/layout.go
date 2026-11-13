package catapultcoop

import (
	"fmt"
	"strings"
)

// A keep is the fixed outer shell for a game: size, the outer wall line, four
// catapults and their lanes. It is chosen by player count at the start and
// never changes during a game. Each level brings its own interior layout of
// that keep (which cells are raised, blocked, stairs; where engineers start;
// where bombs lie at the start of the level).
//
// Geometry: cells (x, y), x to the right, y down, origin top-left. The outer
// wall is the row y = 0 and the column x = 0 (the two sides far from the
// viewer in the TV's isometric view); catapults sit in it, two per side. The
// rampart walkway is the row y = 1 and the column x = 1, at height 1. Lanes
// leave the keep from each catapult outward: (0,−1) from the y = 0 side,
// (−1,0) from the x = 0 side. Lane position p of lane L is the cell
// (L.X + p·L.Dir[0], L.Y + p·L.Dir[1]); position 0 is next to the wall.

// Cell kinds.
const (
	KFloor    = "floor"
	KBlock    = "block"
	KStairs   = "stairs"
	KCatapult = "catapult"
	KVoid     = "void"
)

// Cell is one grid cell. Stairs connect both heights (their h is 0).
type Cell struct {
	Kind string `json:"kind"`
	H    int    `json:"h"`
}

// Catapult is a catapult in the outer wall.
type Catapult struct {
	ID   int `json:"id"`
	X    int `json:"x"`
	Y    int `json:"y"`
	Lane int `json:"lane"`
}

// Lane is the lane a catapult fires down.
type Lane struct {
	ID  int    `json:"id"`
	Cat int    `json:"cat"`
	Len int    `json:"len"`
	Dir [2]int `json:"dir"` // unit vector pointing away from the keep
	X   int    `json:"x"`   // cell of position 0 (just outside the wall)
	Y   int    `json:"y"`
}

// Layout is one level's interior of a keep.
type Layout struct {
	ID     string   `json:"id"`
	W      int      `json:"w"`
	H      int      `json:"h"`
	Cells  [][]Cell `json:"cells"`  // cells[y][x]
	Spawns [][2]int `json:"spawns"` // engineer start cells, in seating order
	Bombs  [][2]int `json:"-"`      // bombs lying here at the level start
}

// Keep is a keep shell and its layouts.
type Keep struct {
	ID         string             `json:"id"`
	MinPlayers int                `json:"minPlayers"`
	MaxPlayers int                `json:"maxPlayers"`
	W          int                `json:"w"`
	H          int                `json:"h"`
	Catapults  []Catapult         `json:"catapults"`
	Lanes      []Lane             `json:"lanes"`
	Layouts    map[string]*Layout `json:"-"`
}

const laneLen = 6

// Legend of the layout drawings:
//
//	W outer wall (block, h1)   C catapult (h1)    = floor h1 (rampart, platform)
//	. floor h0                 # crate (block h0) S stairs
//	@ engineer start (floor h0)  o bomb (floor h0)  * bomb (floor h1)  (space) void
var keepArt = []struct {
	id       string
	min, max int
	layouts  map[string][]string
}{
	{"small", 1, 5, map[string][]string{
		"open": {
			"WWWCWWCWW",
			"W=======S",
			"W=.....o.",
			"C=.......",
			"W=..@@...",
			"W=..@@...",
			"C=..@@...",
			"W=..@@...",
			"WS.......",
		},
		"crates": {
			"WWWCWWCWW",
			"W=======S",
			"W=..o..#.",
			"C=.#....o",
			"W=..@@.#.",
			"W=o.@@...",
			"C=..@@.o.",
			"W=.#@@...",
			"WS...o...",
		},
		"platform": {
			"WWWCWWCWW",
			"W=======S",
			"W=.o.....",
			"C=...==*.",
			"W=...=S.o",
			"W=@@.....",
			"C=@@..#..",
			"W=@@..o..",
			"WS@@.....",
		},
		"split": {
			"WWWCWWCWW",
			"W=======S",
			"W=.o.#...",
			"C=...#.o.",
			"W=.==S...",
			"W=.*=#...",
			"C=...#@@.",
			"W=o...@@@",
			"WS....@@@",
		},
	}},
	{"large", 6, 8, map[string][]string{
		"open": {
			"WWWCWWWWCWW",
			"W====S====S",
			"W=...o.....",
			"C=.........",
			"W=.........",
			"W=..@@@@...",
			"WS..@@@@...",
			"W=.........",
			"C=.........",
			"W=.........",
			"WS.........",
		},
		"crates": {
			"WWWCWWWWCWW",
			"W====S====S",
			"W=..o...#..",
			"C=.#....o..",
			"W=....#....",
			"W=.o@@@@.#.",
			"WS..@@@@..o",
			"W=.#...o...",
			"C=......#..",
			"W=..o......",
			"WS.....#...",
		},
		"platform": {
			"WWWCWWWWCWW",
			"W====S====S",
			"W=.o.......",
			"C=...===*..",
			"W=...=S=..o",
			"W=.......#.",
			"WS..@@@@...",
			"W=..@@@@.o.",
			"C=.#.......",
			"W=...o.....",
			"WS.........",
		},
		"split": {
			"WWWCWWWWCWW",
			"W====S====S",
			"W=.o..#....",
			"C=....#.o..",
			"W=.==S#....",
			"W=.*=.#..o.",
			"WS....S==..",
			"W=.o..#=*..",
			"C=....#....",
			"W=..@@@@...",
			"WS..@@@@...",
		},
	}},
}

// Keeps are the keep shells, smallest first.
var Keeps = func() []*Keep {
	var out []*Keep
	for _, ka := range keepArt {
		k := &Keep{ID: ka.id, MinPlayers: ka.min, MaxPlayers: ka.max, Layouts: map[string]*Layout{}}
		for id, rows := range ka.layouts {
			l := parseLayout(id, rows)
			k.Layouts[id] = l
			if k.W == 0 {
				k.W, k.H = l.W, l.H
				k.Catapults, k.Lanes = shellOf(l)
			}
		}
		out = append(out, k)
	}
	return out
}()

// KeepByID looks a keep up.
func KeepByID(id string) *Keep {
	for _, k := range Keeps {
		if k.ID == id {
			return k
		}
	}
	return nil
}

// keepFor picks the keep for n players.
func keepFor(n int) *Keep {
	for _, k := range Keeps {
		if n <= k.MaxPlayers {
			return k
		}
	}
	return Keeps[len(Keeps)-1]
}

// LevelLayout is the layout of level lv (1-based) in this keep.
func (k *Keep) LevelLayout(lv int) *Layout {
	lv = min(max(lv, 1), len(Defs.Levels))
	return k.Layouts[Defs.Levels[lv-1].Layout]
}

func parseLayout(id string, rows []string) *Layout {
	l := &Layout{ID: id, H: len(rows), W: len(rows[0])}
	for y, row := range rows {
		if len(row) != l.W {
			panic(fmt.Sprintf("layout %s: row %d has length %d", id, y, len(row)))
		}
		line := make([]Cell, l.W)
		for x, ch := range row {
			c := Cell{Kind: KFloor}
			switch ch {
			case 'W':
				c = Cell{Kind: KBlock, H: 1}
			case 'C':
				c = Cell{Kind: KCatapult, H: 1}
			case '=':
				c.H = 1
			case '.':
			case '#':
				c.Kind = KBlock
			case 'S':
				c.Kind = KStairs
			case '@':
				l.Spawns = append(l.Spawns, [2]int{x, y})
			case 'o':
				l.Bombs = append(l.Bombs, [2]int{x, y})
			case '*':
				c.H = 1
				l.Bombs = append(l.Bombs, [2]int{x, y})
			case ' ':
				c.Kind = KVoid
			default:
				panic(fmt.Sprintf("layout %s: bad cell %q", id, ch))
			}
			line[x] = c
		}
		l.Cells = append(l.Cells, line)
	}
	return l
}

// shellOf finds the catapults (row y = 0 left to right, then column x = 0 top
// to bottom) and builds their lanes.
func shellOf(l *Layout) ([]Catapult, []Lane) {
	var cats []Catapult
	var lanes []Lane
	add := func(x, y int, dir [2]int) {
		id := len(cats)
		cats = append(cats, Catapult{ID: id, X: x, Y: y, Lane: id})
		lanes = append(lanes, Lane{ID: id, Cat: id, Len: laneLen, Dir: dir, X: x + dir[0], Y: y + dir[1]})
	}
	for x := 0; x < l.W; x++ {
		if l.Cells[0][x].Kind == KCatapult {
			add(x, 0, [2]int{0, -1})
		}
	}
	for y := 1; y < l.H; y++ {
		if l.Cells[y][0].Kind == KCatapult {
			add(0, y, [2]int{-1, 0})
		}
	}
	return cats, lanes
}

// String draws the layout back as art (debugging).
func (l *Layout) String() string {
	var b strings.Builder
	for y := 0; y < l.H; y++ {
		for x := 0; x < l.W; x++ {
			c := l.Cells[y][x]
			ch := map[string]byte{KFloor: '.', KBlock: '#', KStairs: 'S', KCatapult: 'C', KVoid: ' '}[c.Kind]
			if c.Kind == KFloor && c.H == 1 {
				ch = '='
			}
			b.WriteByte(ch)
		}
		b.WriteByte('\n')
	}
	return b.String()
}

// --- geometry ----------------------------------------------------------------

// Dirs4 is the neighbour order used everywhere (deterministic paths).
var Dirs4 = [4][2]int{{0, -1}, {1, 0}, {0, 1}, {-1, 0}}

// In reports whether (x, y) is on the grid.
func (l *Layout) In(x, y int) bool { return x >= 0 && y >= 0 && x < l.W && y < l.H }

// At returns the cell at (x, y); off-grid cells are void.
func (l *Layout) At(x, y int) Cell {
	if !l.In(x, y) {
		return Cell{Kind: KVoid}
	}
	return l.Cells[y][x]
}

// Walkable: floor or stairs.
func (l *Layout) Walkable(x, y int) bool {
	k := l.At(x, y).Kind
	return k == KFloor || k == KStairs
}

// CanStep reports whether an engineer may step between two 4-adjacent cells:
// both walkable, and equal height unless either is stairs.
func (l *Layout) CanStep(ax, ay, bx, by int) bool {
	if !l.Walkable(ax, ay) || !l.Walkable(bx, by) || abs(ax-bx)+abs(ay-by) != 1 {
		return false
	}
	a, b := l.At(ax, ay), l.At(bx, by)
	return a.Kind == KStairs || b.Kind == KStairs || a.H == b.H
}

// Dists returns walking steps from (x, y) to every cell (−1 = unreachable),
// ignoring engineers.
func (l *Layout) Dists(x, y int) [][]int {
	d := make([][]int, l.H)
	for i := range d {
		d[i] = make([]int, l.W)
		for j := range d[i] {
			d[i][j] = -1
		}
	}
	if !l.Walkable(x, y) {
		return d
	}
	d[y][x] = 0
	q := [][2]int{{x, y}}
	for len(q) > 0 {
		c := q[0]
		q = q[1:]
		for _, dv := range Dirs4 {
			nx, ny := c[0]+dv[0], c[1]+dv[1]
			if l.In(nx, ny) && d[ny][nx] < 0 && l.CanStep(c[0], c[1], nx, ny) {
				d[ny][nx] = d[c[1]][c[0]] + 1
				q = append(q, [2]int{nx, ny})
			}
		}
	}
	return d
}

// Path returns a shortest walking path from (fx, fy) to (tx, ty), excluding
// the start and including the destination, or nil if unreachable.
func (l *Layout) Path(fx, fy, tx, ty int) [][2]int {
	d := l.Dists(tx, ty) // walk back down the gradient from the start
	if !l.In(fx, fy) || d[fy][fx] < 0 {
		return nil
	}
	var out [][2]int
	x, y := fx, fy
	for d[y][x] > 0 {
		for _, dv := range Dirs4 {
			nx, ny := x+dv[0], y+dv[1]
			if l.In(nx, ny) && d[ny][nx] == d[y][x]-1 && l.CanStep(x, y, nx, ny) {
				x, y = nx, ny
				break
			}
		}
		out = append(out, [2]int{x, y})
	}
	return out
}

// LoadCell reports whether an engineer at (x, y) can load or fire catapult
// c: 4-adjacent, on a floor cell of the catapult's height.
func (l *Layout) LoadCell(x, y int, c Catapult) bool {
	cell := l.At(x, y)
	return cell.Kind == KFloor && cell.H == l.At(c.X, c.Y).H && abs(x-c.X)+abs(y-c.Y) == 1
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
