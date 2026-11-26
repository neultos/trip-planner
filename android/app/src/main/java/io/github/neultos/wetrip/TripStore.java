package io.github.neultos.wetrip;

import android.content.Context;
import android.content.SharedPreferences;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/** 위젯이 쓰는 여행 목록 (id, 제목, 날짜만). 앱을 열 때마다 웹의 목록으로 새로 고침 */
final class TripStore {
    static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final Pattern DAY = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    static final String AUTO = "auto";

    static final class Trip {
        final String id, title, start, end;
        Trip(String id, String title, String start, String end) { this.id = id; this.title = title; this.start = start; this.end = end; }
    }

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("widget", Context.MODE_PRIVATE); }

    /** evaluateJavascript 결과(JSON 문자열 리터럴)를 받아 저장. 바뀌었으면 true */
    static boolean saveFromJs(Context c, String jsValue) {
        try {
            Object v = new JSONTokener(jsValue).nextValue();
            if (!(v instanceof String)) return false; // 목록이 없으면(로그아웃 등) 예전 것을 그대로 둠
            JSONArray in = new JSONArray((String) v), out = new JSONArray();
            for (int i = 0; i < in.length() && out.length() < 50; i++) {
                JSONObject o = in.optJSONObject(i);
                if (o == null) continue;
                String id = o.optString("id"), s = o.optString("start"), e = o.optString("end", s);
                if (!ID.matcher(id).matches() || !DAY.matcher(s).matches()) continue;
                if (!DAY.matcher(e).matches()) e = s;
                String t = o.optString("title", "나의 여행");
                out.put(new JSONObject().put("id", id).put("title", t.length() > 40 ? t.substring(0, 40) : t).put("start", s).put("end", e));
            }
            String json = out.toString();
            if (json.equals(prefs(c).getString("trips", ""))) return false;
            prefs(c).edit().putString("trips", json).apply();
            return true;
        } catch (Exception e) { return false; }
    }

    static List<Trip> all(Context c) {
        List<Trip> l = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs(c).getString("trips", "[]"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                l.add(new Trip(o.getString("id"), o.getString("title"), o.getString("start"), o.getString("end")));
            }
        } catch (Exception ignored) {}
        return l;
    }

    /** 위젯에 고른 여행. 자동이거나 목록에서 사라졌으면 여행 중 → 가장 가까운 다가올 여행 → 가장 최근 다녀온 여행 */
    static Trip pick(Context c, String chosen, LocalDate today) {
        List<Trip> l = all(c);
        for (Trip t : l) if (t.id.equals(chosen)) return t;
        Trip now = null, next = null, past = null;
        for (Trip t : l) {
            LocalDate s = LocalDate.parse(t.start), e = LocalDate.parse(t.end);
            if (!today.isBefore(s) && !today.isAfter(e)) { if (now == null) now = t; }
            else if (today.isBefore(s)) { if (next == null || s.isBefore(LocalDate.parse(next.start))) next = t; }
            else if (past == null || e.isAfter(LocalDate.parse(past.end))) past = t;
        }
        return now != null ? now : next != null ? next : past;
    }

    /** "D-3" · "여행 중 2일차" · "D-Day" · "다녀온 여행" */
    static String badge(Trip t, LocalDate today) {
        LocalDate s = LocalDate.parse(t.start), e = LocalDate.parse(t.end);
        long d = ChronoUnit.DAYS.between(today, s);
        if (d > 0) return "D-" + d;
        if (!today.isAfter(e)) return d == 0 ? "D-Day" : "여행 중 " + (1 - d) + "일차";
        return "다녀온 여행";
    }

    static String dates(Trip t) {
        LocalDate s = LocalDate.parse(t.start), e = LocalDate.parse(t.end);
        String a = s.getMonthValue() + "." + s.getDayOfMonth();
        if (s.equals(e)) return a;
        return a + " – " + (s.getYear() == e.getYear() && s.getMonth() == e.getMonth() ? "" : e.getMonthValue() + ".") + e.getDayOfMonth()
            + " · " + (ChronoUnit.DAYS.between(s, e)) + "박 " + (ChronoUnit.DAYS.between(s, e) + 1) + "일";
    }
}
