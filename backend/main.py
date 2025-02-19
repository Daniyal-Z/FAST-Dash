from fastapi import FastAPI, Query, HTTPException, Request
from services.datesheet import load_datesheet, filter_datesheet, get_courses_with_codes, extract_time_slots
from fastapi.middleware.cors import CORSMiddleware

import logging

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = FastAPI()

# Allow frontend to access backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins; change this in production
    allow_credentials=True,
    allow_methods=["*"],  # Allows all HTTP methods (GET, POST, etc.)
    allow_headers=["*"],  # Allows all headers
)

@app.get("/datesheet")
def get_datesheet(courses: str = Query("")):
    try:
        df = load_datesheet("data/mid1.xlsx")
        #logger.debug("Headers: %s", df.columns.to_list())

        # Extract time slots
        time_slots = extract_time_slots(df)  # extract time slots before data filtering because time slot headers are removed
        print("Time slots:", time_slots)   

        course_list = [course.strip() for course in courses.split(",") if course]
        if course_list:
            df = filter_datesheet(df, course_list)
        

        #logger.debug("Time Slot: %s", df.columns)

        return{
            "data_sheet": df.to_dict(orient="records"),
            "time_slots": time_slots,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/courses")
def get_course_suggestions(request: Request, query: str = Query("")):
    try:
        df = load_datesheet("data/mid1.xlsx")
        courses = get_courses_with_codes(df)
        print(f"Query:")

        # Debugging - Check query parameter
        print(f"Received Query: {query}")

        # If query is provided, filter courses
        if query:
            query_lower = query.strip().lower()
            filtered_courses = [
                course for course in courses
                if query_lower in course["name"].lower() or query_lower in course["code"].lower()
            ]
            print(f"Filtered Courses: {filtered_courses}")  # Debugging
            return filtered_courses

        return courses  # Return all courses if no query
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))