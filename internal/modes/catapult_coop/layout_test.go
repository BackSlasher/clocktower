package catapultcoop

import "testing"

// Every authored layout must be playable: same shell as its keep, every
// catapult loadable from the rampart, no walled-off walkable regions, every
// loading cell and initial bomb reachable from every spawn, enough spawns.
func TestLayoutsValid(t *testing.T) {
	for _, k := range Keeps {
		if len(k.Catapults) != 4 || len(k.Lanes) != 4 {
			t.Errorf("keep %s: %d catapults, %d lanes", k.ID, len(k.Catapults), len(k.Lanes))
		}
		for _, ld := range Defs.Levels {
			if k.Layouts[ld.Layout] == nil {
				t.Errorf("keep %s has no layout %q (level %s)", k.ID, ld.Layout, ld.Name)
			}
		}
		for id, l := range k.Layouts {
			name := k.ID + "/" + id
			if l.W != k.W || l.H != k.H {
				t.Errorf("%s: size %dx%d, keep %dx%d", name, l.W, l.H, k.W, k.H)
				continue
			}
			cats, _ := shellOf(l)
			if len(cats) != len(k.Catapults) {
				t.Errorf("%s: catapults differ from the keep", name)
				continue
			}
			for i := range cats {
				if cats[i] != k.Catapults[i] {
					t.Errorf("%s: catapult %d at %v, keep has %v", name, i, cats[i], k.Catapults[i])
				}
			}
			// The outer wall line is identical in every layout.
			for x := 0; x < l.W; x++ {
				if l.Cells[0][x].Kind != KBlock && l.Cells[0][x].Kind != KCatapult {
					t.Errorf("%s: (%d,0) is not wall", name, x)
				}
			}
			for y := 0; y < l.H; y++ {
				if l.Cells[y][0].Kind != KBlock && l.Cells[y][0].Kind != KCatapult {
					t.Errorf("%s: (0,%d) is not wall", name, y)
				}
			}
			// Throws stop at height-1 blocks, which must therefore only be the
			// outer wall; interior crates are height 0 and flown over.
			for y := 1; y < l.H; y++ {
				for x := 1; x < l.W; x++ {
					if c := l.Cells[y][x]; c.Kind == KBlock && c.H > 0 {
						t.Errorf("%s: raised block inside the keep at (%d,%d)", name, x, y)
					}
				}
			}
			if len(l.Spawns) < Defs.MaxPlayers {
				t.Errorf("%s: only %d spawns", name, len(l.Spawns))
			}
			for _, s := range l.Spawns {
				if c := l.At(s[0], s[1]); c.Kind != KFloor {
					t.Errorf("%s: spawn %v on %+v", name, s, c)
				}
			}
			for _, b := range l.Bombs {
				if l.At(b[0], b[1]).Kind != KFloor {
					t.Errorf("%s: bomb %v not on floor", name, b)
				}
			}
			for _, s := range l.Spawns {
				d := l.Dists(s[0], s[1])
				for y := 0; y < l.H; y++ {
					for x := 0; x < l.W; x++ {
						if l.Walkable(x, y) && d[y][x] < 0 {
							t.Errorf("%s: (%d,%d) unreachable from spawn %v\n%s", name, x, y, s, l)
						}
					}
				}
				for _, c := range k.Catapults {
					ok := false
					for _, dv := range Dirs4 {
						x, y := c.X+dv[0], c.Y+dv[1]
						if l.LoadCell(x, y, c) && d[y][x] >= 0 {
							ok = true
						}
					}
					if !ok {
						t.Errorf("%s: catapult %d cannot be reached from spawn %v", name, c.ID, s)
					}
				}
				for _, b := range l.Bombs {
					ok := false
					for _, dv := range [][2]int{{0, 0}, {0, -1}, {1, 0}, {0, 1}, {-1, 0}} {
						x, y := b[0]+dv[0], b[1]+dv[1]
						if l.In(x, y) && d[y][x] >= 0 {
							ok = true
						}
					}
					if !ok {
						t.Errorf("%s: bomb %v cannot be picked up from spawn %v", name, b, s)
					}
				}
			}
		}
	}
	// Keeps cover 1..MaxPlayers without gaps.
	n := 1
	for _, k := range Keeps {
		if k.MinPlayers != n {
			t.Errorf("keep %s starts at %d, want %d", k.ID, k.MinPlayers, n)
		}
		n = k.MaxPlayers + 1
	}
	if n != Defs.MaxPlayers+1 {
		t.Errorf("keeps end at %d players", n-1)
	}
}

// The tutorial has no platforms: the only raised cells inside the walkway
// are rampart ledges (touching the walkway), plus corner stairs. Its one bomb
// lies next to a stair.
func TestTutorialLayout(t *testing.T) {
	for _, k := range Keeps {
		l := k.LevelLayout(1)
		if len(l.Bombs) != 1 {
			t.Fatalf("%s tutorial has %d bombs", k.ID, len(l.Bombs))
		}
		for y := 2; y < l.H; y++ {
			for x := 2; x < l.W; x++ {
				if c := l.At(x, y); c.Kind == KFloor && c.H > 0 && l.At(x, y-1).H == 0 && l.At(x-1, y).H == 0 {
					t.Errorf("%s tutorial: platform cell at (%d,%d)", k.ID, x, y)
				}
			}
		}
		b, near := l.Bombs[0], false
		for _, d := range Dirs4 {
			if l.At(b[0]+d[0], b[1]+d[1]).Kind == KStairs {
				near = true
			}
		}
		if !near {
			t.Errorf("%s tutorial bomb %v not next to stairs", k.ID, b)
		}
	}
}

// cornerStairs reports whether the stairs at (x, y) sit in an inside corner:
// exactly two raised walkable neighbours at a right angle and two low ones,
// none blocked (the TV draws stairs as corner steps).
func cornerStairs(l *Layout, x, y int) bool {
	var high [][2]int
	low := 0
	for _, d := range Dirs4 {
		c := l.At(x+d[0], y+d[1])
		switch {
		case c.Kind == KFloor && c.H == 1:
			high = append(high, d)
		case c.Kind == KFloor && c.H == 0:
			low++
		}
	}
	return len(high) == 2 && low == 2 && high[0][0]+high[1][0] != 0 && high[0][1]+high[1][1] != 0
}

// Every stairs cell of every layout is a corner step. (None needs an
// exception today; list one here with a reason if it ever must.)
func TestStairsAreCorners(t *testing.T) {
	for _, k := range Keeps {
		for id, l := range k.Layouts {
			n := 0
			for y := 0; y < l.H; y++ {
				for x := 0; x < l.W; x++ {
					if l.At(x, y).Kind != KStairs {
						continue
					}
					n++
					if !cornerStairs(l, x, y) {
						t.Errorf("%s/%s: stairs at (%d,%d) are not in an inside corner\n%s", k.ID, id, x, y, l)
					}
				}
			}
			if n == 0 {
				t.Errorf("%s/%s has no stairs", k.ID, id)
			}
		}
	}
}

func TestPathsRespectHeights(t *testing.T) {
	l := parseLayout("t", flatArt)
	// (3,2) courtyard to (3,1) rampart: adjacent but different heights.
	if l.CanStep(3, 2, 3, 1) {
		t.Fatal("stepped up a wall")
	}
	p := l.Path(3, 2, 3, 1)
	// Must go via the stairs at (8,1): 5 right, up through stairs, 5 left.
	if len(p) != 11 {
		t.Fatalf("path %v (%d)", p, len(p))
	}
	if !l.CanStep(8, 2, 8, 1) || !l.CanStep(8, 1, 7, 1) {
		t.Fatal("stairs do not connect both levels")
	}
}
