package bot

import (
	"fmt"
	"math/rand/v2"
	"os"
	"strings"
	"testing"

	game "clocktower/internal/modes/catapult_coop"
)

func render(rm *game.RoomMsg, s *game.Snap) string {
	l := rm.Layout
	grid := make([][]byte, l.H)
	for y := range grid {
		grid[y] = []byte(strings.Split(l.String(), "\n")[y])
	}
	for _, b := range s.Bombs {
		grid[b.Y][b.X] = "kgs"[map[string]int{"keg": 0, "grapeshot": 1, "stopwatch": 2}[b.Kind]]
	}
	for i, e := range s.Engineers {
		c := byte('0' + i)
		if e.Carry != nil {
			c = byte('A' + i)
		}
		grid[e.Y][e.X] = c
	}
	var b strings.Builder
	for _, r := range grid {
		b.Write(r)
		b.WriteByte('\n')
	}
	fmt.Fprintf(&b, "machines %v cats %v\n", s.Machines, func() (o []string) {
		for _, c := range s.Catapults {
			if c.Bomb != nil {
				o = append(o, c.Bomb.Kind)
			} else {
				o = append(o, "-")
			}
		}
		return
	}())
	return b.String()
}

func TestDebugTrace(t *testing.T) {
	if os.Getenv("CT_TRACE") == "" {
		t.Skip()
	}
	n := 4
	fmt.Sscan(os.Getenv("CT_TRACE"), &n)
	minLv := 1
	fmt.Sscan(os.Getenv("CT_TRACE_LEVEL"), &minLv)
	g := game.New(rand.New(rand.NewPCG(1003, 7)))
	var bots []*Bot
	for i := 0; i < n; i++ {
		pid, _, _ := g.AddPlayer(fmt.Sprint("B", i))
		g.SetConnected(pid, true)
		b := New(pid, uint64(i))
		bots = append(bots, b)
	}
	_ = g.Start(g.Host())
	seen := map[[2]int]bool{}
	for tick := 0; g.Running() && tick < 100000; tick++ {
		snap, room := g.Snapshot(), g.RoomState()
		if key := [2]int{g.Level(), g.Round()}; g.Phase() == game.PhasePlan && g.Level() >= minLv && !seen[key] {
			seen[key] = true
			queues, _ := TeamQueues(room, snap, g.Keep())
			var ps []string
			for _, p := range room.Players {
				var q []string
				for _, a := range queues[p.ID] {
					s := a.A
					if a.DX != nil {
						s += fmt.Sprintf("(%d,%d)", *a.DX, *a.DY)
					}
					q = append(q, s)
				}
				ps = append(ps, strings.Join(q, " "))
			}
			t.Logf("L%d T%d wall %d\n%squeues %q", g.Level(), g.Round(), g.Wall(), render(room, snap), ps)
		}
		for _, b := range bots {
			for _, c := range b.Act(room, snap, g.Keep()) {
				_ = g.Apply(b.ID, c)
				room = g.RoomState()
			}
		}
		g.Step(0.1)
	}
	t.Logf("end %+v", g.End())
}
