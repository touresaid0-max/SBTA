GRANT EXECUTE ON FUNCTION sbta_assign_and_confirm_mobile_booking(uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';