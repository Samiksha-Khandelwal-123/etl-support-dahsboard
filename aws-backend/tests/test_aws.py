import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.aws import _session


class SessionSelectionTests(unittest.TestCase):
    def test_session_prefers_profile_when_configured(self):
        with patch("app.aws.get_settings", return_value=SimpleNamespace(
            aws_profile="my-profile",
            aws_access_key_id="AKIAEXAMPLE",
            aws_secret_access_key="secret-example",
            aws_session_token="token-example",
            aws_region="us-east-1",
        )), patch("app.aws.boto3.session.Session") as mock_session:
            _session()

        mock_session.assert_called_once_with(profile_name="my-profile", region_name="us-east-1")

    def test_session_uses_explicit_credentials_when_profile_is_unset(self):
        with patch("app.aws.get_settings", return_value=SimpleNamespace(
            aws_profile=None,
            aws_access_key_id="AKIAEXAMPLE",
            aws_secret_access_key="secret-example",
            aws_session_token="token-example",
            aws_region="us-east-1",
        )), patch("app.aws.boto3.session.Session") as mock_session:
            _session()

        mock_session.assert_called_once_with(
            aws_access_key_id="AKIAEXAMPLE",
            aws_secret_access_key="secret-example",
            aws_session_token="token-example",
            region_name="us-east-1",
        )

    def test_session_falls_back_to_default_chain(self):
        with patch("app.aws.get_settings", return_value=SimpleNamespace(
            aws_profile=None,
            aws_access_key_id=None,
            aws_secret_access_key=None,
            aws_session_token=None,
            aws_region="us-east-1",
        )), patch("app.aws.boto3.session.Session") as mock_session:
            _session()

        mock_session.assert_called_once_with(region_name="us-east-1")


if __name__ == "__main__":
    unittest.main(verbosity=2)
