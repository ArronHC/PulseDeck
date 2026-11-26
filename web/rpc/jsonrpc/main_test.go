package jsonrpc

import (
	"fmt"
	"os"
	"testing"

	"github.com/komari-monitor/komari/cmd/flags"
	"github.com/komari-monitor/komari/database/dbcore"
)

func TestMain(m *testing.M) {
	flags.DatabaseType = flags.DatabaseTypeSQLite
	flags.DatabaseFile = "file:komari_jsonrpc_test?mode=memory&cache=shared"
	if err := dbcore.Initialize(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer dbcore.Close()

	m.Run()
}
