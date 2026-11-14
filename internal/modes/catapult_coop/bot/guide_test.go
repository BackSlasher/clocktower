package bot

import (
	"os"
	"strconv"
	"testing"
)

// TestGuideTeaches: perfect bots following the tutorial's suggested queues
// finish it without help, and every player has done every lesson (solo: no
// throw to a teammate and no catch).
func TestGuideTeaches(t *testing.T) {
	for n := 1; n <= 4; n++ {
		for seed := uint64(1); seed <= 5; seed++ {
			r := Run(Scenario{Players: n, Seed: seed, Guide: true})
			if r.GuideSkipped || r.GuideGos > 0 {
				t.Fatalf("%d bots, seed %d: tutorial stuck (%d turns, %d gos, skipped %v)", n, seed, r.GuideTurns, r.GuideGos, r.GuideSkipped)
			}
			for pid, l := range r.Learned {
				if n == 1 {
					l.Throw, l.Catch = true, true
				}
				if !l.All() {
					t.Errorf("%d bots, seed %d: %s learned only %+v", n, seed, pid, *l)
				}
			}
			if len(r.Learned) != n {
				t.Errorf("%d bots: %d learned anything", n, len(r.Learned))
			}
			if seed == 1 {
				t.Logf("%d players: tutorial %d turns", n, r.GuideTurns)
			}
		}
	}
}

// TestGuideNoDeadlock: sloppy, wandering and idle teams get through the
// tutorial (with the host's go on stuck turns, as a host would).
func TestGuideNoDeadlock(t *testing.T) {
	runs := 10
	if v, err := strconv.Atoi(os.Getenv("CT_BALANCE_RUNS")); err == nil && v > 0 {
		runs = v
	}
	for _, sc := range []Scenario{
		{Players: 2, Mistake: 0.25}, {Players: 3, Mistake: 0.25}, {Players: 4, Mistake: 0.25},
		{Players: 4, Mistake: 0.25, Wander: 0.1}, {Players: 3, Idle: 1, Mistake: 0.25}, {Players: 1, Idle: 3},
	} {
		sc.Guide = true
		turns, gos, skipped, all, seats := 0, 0, 0, 0, 0
		for _, r := range RunMany(sc, 500, runs) {
			turns += r.GuideTurns
			gos += r.GuideGos
			if r.GuideSkipped {
				skipped++
			}
			for _, l := range r.Learned {
				seats++
				if l.All() {
					all++
				}
			}
		}
		t.Logf("%d bots + %d idle, %.0f%% wasted, %.0f%% wander: tutorial %.1f turns, %.1f host gos, %d/%d skipped, %d/%d players did every lesson",
			sc.Players, sc.Idle, 100*sc.Mistake, 100*sc.Wander, float64(turns)/float64(runs), float64(gos)/float64(runs), skipped, runs, all, seats)
		if sc.Idle == 0 && skipped > runs/5 {
			t.Errorf("tutorial skipped too often")
		}
	}
}
