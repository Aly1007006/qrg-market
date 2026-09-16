CREATE FUNCTION qrg_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER shops_updated_at BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER shop_members_updated_at BEFORE UPDATE ON shop_members FOR EACH ROW EXECUTE FUNCTION qrg_touch_updated_at();
--> statement-breakpoint
CREATE FUNCTION qrg_assert_shop_owner(target_shop uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize ownership changes for the same shop. Deleted shops need no owner.
  PERFORM id FROM shops WHERE id = target_shop FOR UPDATE;
  IF FOUND AND (SELECT count(*) FROM shop_members WHERE shop_id = target_shop AND role = 'SHOP_OWNER') <> 1 THEN
    RAISE EXCEPTION 'Shop must have exactly one owner' USING ERRCODE = '23514', CONSTRAINT = 'shops_exactly_one_owner';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION qrg_check_shop_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'shops' THEN
    PERFORM qrg_assert_shop_owner(NEW.id);
  ELSE
    IF TG_OP <> 'INSERT' THEN
      PERFORM qrg_assert_shop_owner(OLD.shop_id);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      PERFORM qrg_assert_shop_owner(NEW.shop_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER shops_owner_required AFTER INSERT ON shops DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qrg_check_shop_owner();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER shop_members_owner_required AFTER INSERT OR UPDATE OR DELETE ON shop_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qrg_check_shop_owner();
