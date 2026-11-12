#!/usr/bin/env python3
"""Local, offline schema helper using a pinned official 1EdTech OB3 schema.

This is not an official 1EdTech validator and does not establish certification.
It never verifies a JWS, dereferences keys/status, or performs JSON-LD processing.
It prints no credential values. An optional jti comparison is a separate derived
view, never a repair to the input or an assertion of VC 2.0 JWT conformance.
"""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import sys

SCHEMA_URL = "https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json"
SCHEMA_SHA256 = "b7358e895f492e74055dc6bfc7ffc420d0e497f90c4579fb83d9519b86d393ea"
MAX_BYTES = 2 * 1024 * 1024
MAX_ERRORS = 20
VC2_CONTEXT = "https://www.w3.org/ns/credentials/v2"
VC11_CONTEXT = "https://www.w3.org/2018/credentials/v1"


class AssessmentError(Exception):
    """Carries a fixed, non-sensitive error code only."""


def read_bounded(path: Path, failure: str) -> bytes:
    try:
        with path.open("rb") as stream:
            value = stream.read(MAX_BYTES + 1)
    except OSError:
        raise AssessmentError(failure) from None
    if len(value) > MAX_BYTES:
        raise AssessmentError("input_exceeds_two_megabytes")
    return value


def strict_json(value: bytes):
    def unique_object(pairs):
        result = {}
        for key, item in pairs:
            if key in result:
                raise AssessmentError("duplicate_json_member")
            result[key] = item
        return result

    def no_nonfinite(_value):
        raise AssessmentError("nonfinite_json_number")

    try:
        return json.loads(value.decode("utf-8"), object_pairs_hook=unique_object,
                          parse_constant=no_nonfinite)
    except (UnicodeError, ValueError, RecursionError):
        raise AssessmentError("invalid_json") from None


def schema_material(path: Path):
    raw = read_bounded(path, "schema_read_failed")
    if hashlib.sha256(raw).hexdigest() != SCHEMA_SHA256:
        raise AssessmentError("official_schema_checksum_mismatch")
    schema = strict_json(raw)
    names = set()
    formats = set()
    pending = [schema]
    while pending:
        item = pending.pop()
        if isinstance(item, dict):
            names.update(item.get("properties", {}))
            if "format" in item:
                formats.add(item["format"])
            for key in ("$ref", "$recursiveRef", "$dynamicRef"):
                if key in item and not item[key].startswith("#"):
                    raise AssessmentError("external_schema_reference_refused")
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    try:
        from jsonschema import Draft201909Validator, FormatChecker
        from referencing import Registry
        from referencing.exceptions import NoSuchResource
    except ImportError:
        raise AssessmentError("dependency_missing_install_requirements_schema") from None

    def deny_retrieval(uri):
        raise NoSuchResource(ref=uri)

    checker = FormatChecker()
    if not formats.issubset(checker.checkers):
        raise AssessmentError("required_schema_format_checker_missing_install_requirements_schema")
    Draft201909Validator.check_schema(schema)
    validator = Draft201909Validator(schema, format_checker=checker,
                                    registry=Registry(retrieve=deny_retrieval))
    return schema, validator, names, formats


def context_version(vc: dict) -> str:
    contexts = vc.get("@context")
    contexts = contexts if isinstance(contexts, list) else [contexts]
    v2, v1 = VC2_CONTEXT in contexts, VC11_CONTEXT in contexts
    if v2 and not v1:
        return "2.0"
    if v1 and not v2:
        return "1.1"
    return "unrecognized-or-mixed"


def decode_input(raw: bytes, input_format: str):
    payload = None
    if input_format == "compact-jwt":
        token = raw.strip()
        parts = token.split(b".")
        if len(parts) != 3 or not all(re.fullmatch(rb"[A-Za-z0-9_-]+", part) for part in parts):
            raise AssessmentError("invalid_compact_jws_structure")
        decoded = []
        try:
            for part in parts:
                data = base64.urlsafe_b64decode(part + b"=" * (-len(part) % 4))
                if base64.urlsafe_b64encode(data).rstrip(b"=") != part:
                    raise AssessmentError("noncanonical_base64url")
                decoded.append(data)
        except ValueError:
            raise AssessmentError("invalid_base64url") from None
        header = strict_json(decoded[0])
        payload = strict_json(decoded[1])
        if not isinstance(header, dict) or not isinstance(payload, dict):
            raise AssessmentError("jwt_header_or_payload_not_object")
        digest = hashlib.sha256(token).hexdigest()
        digest_basis = "trimmed-compact-jwt-bytes-matches-client-credentialSha256"
    else:
        value = strict_json(raw)
        if not isinstance(value, dict):
            raise AssessmentError("json_input_not_object")
        if input_format == "jwt-payload-json":
            payload = value
        digest = hashlib.sha256(raw).hexdigest()
        digest_basis = "input-file-bytes"
    if payload is not None:
        vc = payload.get("vc")
        if not isinstance(vc, dict):
            raise AssessmentError("expected_nested_vc_object_use_vc_json_for_bare_credential")
        location = "payload.vc"
    else:
        vc = value
        location = "document"
    return vc, payload, {"format": input_format, "sha256": digest,
                         "hash_basis": digest_basis, "credential_location": location}


def safe_pointer(path, names: set[str]) -> str:
    parts = []
    for part in path:
        if isinstance(part, int):
            text = str(part)
        else:
            text = part if part in names else "<redacted-key>"
        parts.append(text.replace("~", "~0").replace("/", "~1"))
    return "/" + "/".join(parts) if parts else ""


def assess(vc: dict, validator, names: set[str]) -> dict:
    errors = list(validator.iter_errors(vc))
    errors.sort(key=lambda error: (safe_pointer(error.absolute_path, names), str(error.validator)))
    safe_errors = []
    for error in errors[:MAX_ERRORS]:
        item = {"instance_pointer": safe_pointer(error.absolute_path, names),
                "keyword": error.validator,
                "message": "Official schema constraint not satisfied; claim values omitted."}
        if error.validator == "required" and isinstance(error.instance, dict):
            item["missing_required_properties"] = [
                name if name in names else "<redacted-key>"
                for name in error.validator_value if name not in error.instance
            ]
        safe_errors.append(item)
    return {"schema_conformant": not errors, "error_count": len(errors),
            "errors": safe_errors, "errors_truncated": len(errors) > MAX_ERRORS}


def compare_jti(vc: dict, payload: dict | None, requested: bool, validator, names):
    info = {
        "requested": requested,
        "status": "not-requested" if not requested else "not-applicable-no-jwt-payload",
        "scope": "Diagnostic jti-to-id comparison only; never a conformance verdict on JWT encoding.",
        "reference": "https://www.w3.org/TR/vc-data-model-1.1/#json-web-token",
        "vc2_applicability": "Legacy mapping does not establish a VC 2.0 securing profile.",
        "changes": [],
    }
    if not requested or payload is None:
        return info, None
    jti = payload.get("jti")
    if not isinstance(jti, str) or not jti:
        info["status"] = "blocked-missing-or-invalid-jti"
        return info, None
    if "id" in vc and vc["id"] != jti:
        info["status"] = "blocked-conflicting-id"
        return info, None
    derived = copy.deepcopy(vc)
    if "id" not in derived:
        derived["id"] = jti
        info["changes"].append({"from": "payload.jti", "to": "/id",
                                "action": "added-only-to-derived-copy"})
    info["status"] = "compared"
    info["existing_id_matches_jti"] = "id" in vc
    info["derived_schema_result"] = assess(derived, validator, names)
    return info, derived


def criteria_negative(vc: dict, baseline_name: str, requested: bool, validator, names):
    result = {"requested": requested, "status": "not-requested"}
    if not requested:
        return result
    result.update({"baseline_view": baseline_name,
                   "baseline_schema_conformant": assess(vc, validator, names)["schema_conformant"],
                   "input_credential_modified": False,
                   "cryptographic_tamper_test": "not-performed"})
    subject = vc.get("credentialSubject")
    achievement = subject.get("achievement") if isinstance(subject, dict) else None
    if not isinstance(achievement, dict) or "criteria" not in achievement:
        result["status"] = "not-isolatable-criteria-already-absent-or-wrong-shape"
        result["isolated_test_passed"] = None
        return result
    changed = copy.deepcopy(vc)
    del changed["credentialSubject"]["achievement"]["criteria"]
    expected = any(error.validator == "required"
                   and list(error.absolute_path) == ["credentialSubject", "achievement"]
                   and "criteria" in error.validator_value
                   for error in validator.iter_errors(changed))
    result.update({"status": "criteria-removal-assessed",
                   "removed_pointer": "/credentialSubject/achievement/criteria",
                   "required_criteria_rejection_observed": expected,
                   "isolated_test_passed": bool(expected and result["baseline_schema_conformant"]),
                   "derived_schema_result": assess(changed, validator, names)})
    return result


def write_report(report: dict, output: Path | None):
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if output is not None:
        try:
            descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                 | getattr(os, "O_NOFOLLOW", 0), 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(rendered)
        except OSError:
            raise AssessmentError("output_create_failed_existing_reports_are_not_overwritten") from None
    sys.stdout.write(rendered)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--credential-file", type=Path, required=True)
    parser.add_argument("--input-format", choices=("compact-jwt", "vc-json", "jwt-payload-json"),
                        default="compact-jwt")
    parser.add_argument("--schema-file", type=Path, required=True,
                        help="Pinned official schema; bytes must match the recorded SHA-256.")
    parser.add_argument("--compare-jti-mapping", action="store_true",
                        help="Separately compare jti -> missing id; do not change the raw VC result.")
    parser.add_argument("--criteria-negative-test", action="store_true")
    parser.add_argument("--output", type=Path,
                        help="Create a new mode-0600 sanitized report; existing file is refused.")
    args = parser.parse_args()
    schema, validator, names, formats = schema_material(args.schema_file)
    vc, payload, input_info = decode_input(read_bounded(args.credential_file, "credential_read_failed"),
                                          args.input_format)
    embedded = assess(vc, validator, names)
    mapping, derived = compare_jti(vc, payload, args.compare_jti_mapping, validator, names)
    negative = criteria_negative(derived if derived is not None else vc,
                                 "explicit-jti-comparison" if derived is not None else "embedded-credential",
                                 args.criteria_negative_test, validator, names)
    report = {
        "report_schema": "elevenid.trial.ob3-schema-assessment/v1",
        "assessment_scope": "Full pinned OB3 AchievementCredential JSON Schema; schema assessment is a subset of OB3 verification and is not certification.",
        "input": input_info,
        "schema_source": {"url": SCHEMA_URL, "sha256": SCHEMA_SHA256,
                          "dialect": schema["$schema"],
                          "validator": "jsonschema.Draft201909Validator",
                          "validator_version": importlib.metadata.version("jsonschema"),
                          "format_checker": "enabled-for-every-format-in-this-schema",
                          "checked_formats": sorted(formats),
                          "rfc3339_validator_version": importlib.metadata.version("rfc3339-validator"),
                          "network_retrieval": "disabled"},
        "vc_context_version": context_version(vc),
        "embedded_credential": embedded,
        "explicit_jti_comparison": mapping,
        "criteria_negative_test": negative,
        "unperformed_checks": ["JWS cryptographic verification", "JSON-LD safe-mode processing",
                               "JWT securing-profile conformance", "issuer trust and subject binding",
                               "validity against current time", "status or revocation", "1EdTech certification"],
        "jws_verification": {"performed_by_this_tool": False,
                             "separate_client_result_required": True,
                             "decoded_claims_are_unverified_here": payload is not None},
        "input_credential_modified": False,
        "exit_code_basis": "0: raw embedded/document schema passed; 1: it failed; 2: assessment could not run. A raw failure alone is not a whole-JWT conformance verdict.",
    }
    write_report(report, args.output)
    return 0 if embedded["schema_conformant"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssessmentError as error:
        sys.stdout.write(json.dumps({"assessment_scope": "schema-only",
                                     "outcome": "assessment-not-completed",
                                     "error_code": str(error),
                                     "jws_verification_performed": False}) + "\n")
        sys.exit(2)
    except Exception:
        # Never echo exception messages containing credential values or paths.
        sys.stdout.write(json.dumps({"assessment_scope": "schema-only",
                                     "outcome": "assessment-not-completed",
                                     "error_code": "unexpected_validation_error",
                                     "jws_verification_performed": False}) + "\n")
        sys.exit(2)
