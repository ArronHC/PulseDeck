package jsonrpc

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/pkg/rpc"
	"github.com/komari-monitor/komari/web/api"
	"github.com/pquerna/otp/totp"
	"github.com/stretchr/testify/require"
)

func TestAdminExecRequiresSensitive2FA(t *testing.T) {
	key, err := totp.Generate(totp.GenerateOpts{Issuer: "PulseDeck", AccountName: "exec-test"})
	require.NoError(t, err)
	user := models.User{UUID: "exec-test-admin", Username: "exec-test-admin", TwoFactor: key.Secret()}
	db := dbcore.GetDBInstance()
	require.NoError(t, db.Create(&user).Error)
	t.Cleanup(func() { require.NoError(t, db.Delete(&user).Error) })
	router := gin.New()
	router.POST("/api/rpc2", func(c *gin.Context) {
		api.SetPrincipal(c, rpc.NewUserPrincipal(user.UUID))
		OnRpcRequest(c)
	})
	for _, test := range []struct {
		name, code, message string
		errorCode           int
	}{
		{"missing", "", "2FA code is required", rpc.PermissionDenied},
		{"invalid", "invalid", "Invalid 2FA code", rpc.PermissionDenied},
		{"valid", "generate", "Command cannot be empty", rpc.InvalidParams},
	} {
		t.Run(test.name, func(t *testing.T) {
			code := test.code
			if code == "generate" {
				code, err = totp.GenerateCode(key.Secret(), time.Now())
				require.NoError(t, err)
			}
			body := fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"admin:exec","params":{"2fa_code":%q}}`, code)
			res := httptest.NewRecorder()
			router.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/api/rpc2", strings.NewReader(body)))
			require.Equal(t, http.StatusOK, res.Code)
			var response rpc.JsonRpcResponse
			require.NoError(t, json.Unmarshal(res.Body.Bytes(), &response))
			require.NotNil(t, response.Error)
			require.EqualValues(t, test.errorCode, response.Error.Code)
			require.Equal(t, test.message, response.Error.Message)
		})
	}
}
